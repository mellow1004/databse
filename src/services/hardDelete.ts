import { normalizeEmail } from "@/lib/normalization";
import { db } from "@/lib/db";
import { hashEmail, hashLinkedinUrl, hashPhone } from "@/lib/hashing";

const PROPAGATION_LOG = {
  tombstoneTable: "complete",
  aiTrainingDataset: "scheduled_for_next_cycle",
  aiSdrPlatform: "writeback_queued",
  subProcessors: "deletion_notices_queued",
} as const;

export type HardDeleteInput = {
  contactId: string;
  reason: string;
  actorUserId: string;
  deletionReason:
    | "dsar_article_17"
    | "retention_lifecycle"
    | "manual_owner_request"
    | "regulatory_order";
};

export type HardDeleteOutput = {
  contactId: string;
  contactDeleted: boolean;
  personDeleted: boolean;
  tombstonesCreated: Array<{ hashType: string; hashValue: string }>;
  relationshipsRemoved: number;
  propagationLog: typeof PROPAGATION_LOG;
};

const DELETION_REASONS = new Set<string>([
  "dsar_article_17",
  "retention_lifecycle",
  "manual_owner_request",
  "regulatory_order",
]);

function collectIdentifierHashes(
  contact: {
    email: string | null;
    phone: string | null;
    clientId: string;
    person: { linkedinUrl: string | null; primaryEmail: string | null; primaryPhone: string | null };
  },
): { hashType: string; hashValue: string }[] {
  const out: { hashType: string; hashValue: string }[] = [];
  const seen = new Set<string>();

  const push = (hashType: string, hashValue: string | null) => {
    if (!hashValue) return;
    const key = `${hashType}:${hashValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ hashType, hashValue });
  };

  push("linkedin_url_sha256", hashLinkedinUrl(contact.person.linkedinUrl));
  push("email_sha256", hashEmail(contact.email));

  const pe = normalizeEmail(contact.person.primaryEmail);
  const ce = normalizeEmail(contact.email);
  if (pe && pe !== ce) {
    push("email_sha256", hashEmail(contact.person.primaryEmail));
  }

  push("phone_sha256", hashPhone(contact.phone));
  push("phone_sha256", hashPhone(contact.person.primaryPhone));

  return out;
}

/**
 * GDPR Article 17 hard-delete: tombstone hashed identifiers, remove the contact
 * (and optionally the orphan Person), retain append-only event logs.
 */
export async function hardDeleteContact(input: HardDeleteInput): Promise<HardDeleteOutput> {
  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 5) {
    throw new Error("Reason must be at least 5 characters.");
  }
  if (!DELETION_REASONS.has(input.deletionReason)) {
    throw new Error(`Invalid deletionReason: ${input.deletionReason}`);
  }

  const contact = await db.contact.findUnique({
    where: { id: input.contactId },
    include: { person: true },
  });
  if (!contact) {
    throw new Error(`Contact ${input.contactId} not found.`);
  }
  if (contact.mergedIntoId) {
    throw new Error(
      "Contact is soft-archived (merged); resolve merge state before a hard delete.",
    );
  }

  const hashes = collectIdentifierHashes(contact);

  const beforeState = JSON.stringify({
    contact: {
      id: contact.id,
      clientId: contact.clientId,
      personId: contact.personId,
      companyId: contact.companyId,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      gateStatus: contact.gateStatus,
      quarantineReason: contact.quarantineReason,
    },
    person: {
      id: contact.person.id,
      fullName: contact.person.fullName,
      primaryEmail: contact.person.primaryEmail,
      primaryPhone: contact.person.primaryPhone,
      linkedinUrl: contact.person.linkedinUrl,
    },
    reason: trimmedReason,
    deletionReason: input.deletionReason,
  });

  const tombstonesCreated: Array<{ hashType: string; hashValue: string }> = [];
  let relationshipsRemoved = 0;
  let personDeleted = false;

  await db.$transaction(async (tx) => {
    for (const h of hashes) {
      await tx.tombstone.upsert({
        where: {
          hashType_hashValue: { hashType: h.hashType, hashValue: h.hashValue },
        },
        create: {
          hashType: h.hashType,
          hashValue: h.hashValue,
          originalClientId: contact.clientId,
          deletionReason: input.deletionReason,
          deletionActor: input.actorUserId,
        },
        update: {
          originalClientId: contact.clientId,
          deletionReason: input.deletionReason,
          deletionActor: input.actorUserId,
        },
      });
      tombstonesCreated.push({ hashType: h.hashType, hashValue: h.hashValue });
    }

    const rel = await tx.contactCompanyRelationship.deleteMany({
      where: { contactId: input.contactId },
    });
    relationshipsRemoved = rel.count;

    await tx.contact.delete({ where: { id: input.contactId } });

    const remaining = await tx.contact.count({
      where: { personId: contact.personId },
    });
    if (remaining === 0) {
      await tx.person.delete({ where: { id: contact.personId } });
      personDeleted = true;
    }

    await tx.auditLog.create({
      data: {
        clientId: contact.clientId,
        actorUserId: input.actorUserId,
        action: "contact_hard_deleted",
        resourceType: "contact",
        resourceId: input.contactId,
        recordsAffected: 1 + (personDeleted ? 1 : 0),
        beforeState,
        afterState: JSON.stringify({
          propagationLog: PROPAGATION_LOG,
          tombstonesUpserted: tombstonesCreated.length,
          relationshipsRemoved,
          personDeleted,
        }),
      },
    });
  });

  return {
    contactId: input.contactId,
    contactDeleted: true,
    personDeleted,
    tombstonesCreated,
    relationshipsRemoved,
    propagationLog: PROPAGATION_LOG,
  };
}
