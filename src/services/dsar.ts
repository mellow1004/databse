import { db } from "@/lib/db";
import { hashEmail, hashLinkedinUrl, hashPhone } from "@/lib/hashing";
import {
  normalizeEmail,
  normalizeLinkedinUrl,
  normalizeName,
  normalizePhone,
} from "@/lib/normalization";
import { hardDeleteContact } from "@/services/hardDelete";

type DsarCaseType =
  | "access"
  | "erasure"
  | "rectification"
  | "objection"
  | "restriction"
  | "portability";

type PropagationTarget =
  | "ai_training_dataset"
  | "ai_sdr_platform"
  | "sub_processors";

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string");
    }
    return [];
  } catch {
    return [];
  }
}

function toActionType(target: PropagationTarget): string {
  if (target === "ai_training_dataset") return "ai_training_propagation_confirmed";
  if (target === "ai_sdr_platform") return "ai_sdr_propagation_confirmed";
  return "sub_processor_propagation_confirmed";
}

async function nextCaseNumber(
  tx: {
    dsarCase: {
      findFirst: typeof db.dsarCase.findFirst;
    };
  },
  receivedAt: Date,
): Promise<string> {
  const year = receivedAt.getUTCFullYear();
  const prefix = `DSAR-${year}-`;
  const latest = await tx.dsarCase.findFirst({
    where: { caseNumber: { startsWith: prefix } },
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  const current = latest?.caseNumber
    ? Number.parseInt(latest.caseNumber.slice(prefix.length), 10)
    : 0;
  const next = Number.isNaN(current) ? 1 : current + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function createDsarCase(input: {
  clientId: string;
  caseType: DsarCaseType;
  subjectEmail?: string;
  subjectPhone?: string;
  subjectLinkedinUrl?: string;
  subjectName?: string;
  ownerId: string;
  actorUserId: string;
}): Promise<{ caseId: string; caseNumber: string }> {
  const receivedAt = new Date();
  const deadlineAt = addDays(receivedAt, 30);

  return db.$transaction(async (tx) => {
    const caseNumber = await nextCaseNumber(tx, receivedAt);
    const row = await tx.dsarCase.create({
      data: {
        clientId: input.clientId,
        caseNumber,
        caseType: input.caseType,
        subjectEmail: normalizeEmail(input.subjectEmail),
        subjectPhone: normalizePhone(input.subjectPhone),
        subjectLinkedinUrl: normalizeLinkedinUrl(input.subjectLinkedinUrl),
        subjectName: normalizeName(input.subjectName),
        ownerId: input.ownerId,
        receivedAt,
        deadlineAt,
      },
      select: { id: true, caseNumber: true },
    });

    await tx.dsarAction.create({
      data: {
        caseId: row.id,
        actionType: "case_opened",
        actorUserId: input.actorUserId,
        metadata: JSON.stringify({
          caseType: input.caseType,
          ownerId: input.ownerId,
        }),
      },
    });

    return { caseId: row.id, caseNumber: row.caseNumber };
  });
}

export async function searchSubject(caseId: string, actorUserId: string): Promise<{
  matchedContacts: Array<{
    contactId: string;
    fullName: string;
    email: string | null;
    company: string;
    matchedOn: string[];
  }>;
}> {
  const dsarCase = await db.dsarCase.findUnique({ where: { id: caseId } });
  if (!dsarCase) throw new Error(`DSAR case ${caseId} not found.`);

  const email = normalizeEmail(dsarCase.subjectEmail);
  const phone = normalizePhone(dsarCase.subjectPhone);
  const linkedin = normalizeLinkedinUrl(dsarCase.subjectLinkedinUrl);
  const name = normalizeName(dsarCase.subjectName);

  if (!email && !phone && !linkedin && !name) {
    throw new Error("At least one subject identifier is required to search.");
  }

  const where = {
    clientId: dsarCase.clientId,
    OR: [
      ...(email ? [{ email }] : []),
      ...(phone ? [{ phone }] : []),
      ...(name
        ? [{ person: { fullName: { contains: name, mode: "insensitive" as const } } }]
        : []),
      ...(linkedin ? [{ person: { linkedinUrl: { contains: linkedin, mode: "insensitive" as const } } }] : []),
    ],
  };

  const rows = await db.contact.findMany({
    where,
    include: {
      person: { select: { fullName: true, linkedinUrl: true, primaryPhone: true } },
      company: { select: { legalName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const tombstoneHashes = new Set(
    [hashEmail(email), hashLinkedinUrl(linkedin), hashPhone(phone)].filter(
      (v): v is string => Boolean(v),
    ),
  );
  const tombstones = tombstoneHashes.size
    ? await db.tombstone.findMany({
        where: {
          OR: [...tombstoneHashes].map((hashValue) => ({ hashValue })),
        },
        select: { hashValue: true },
      })
    : [];
  const tombstoneSet = new Set(tombstones.map((t) => t.hashValue));

  const matchedContacts = rows.map((c) => {
    const matchedOn: string[] = [];
    if (email && normalizeEmail(c.email) === email) matchedOn.push("email");
    if (phone && (normalizePhone(c.phone) === phone || normalizePhone(c.person.primaryPhone) === phone)) {
      matchedOn.push("phone");
    }
    if (
      linkedin &&
      normalizeLinkedinUrl(c.person.linkedinUrl) === linkedin
    ) {
      matchedOn.push("linkedinUrl");
    }
    if (
      name &&
      normalizeName(c.person.fullName)?.toLowerCase().includes(name.toLowerCase())
    ) {
      matchedOn.push("name");
    }

    const contactHashes = [
      hashEmail(c.email),
      hashLinkedinUrl(c.person.linkedinUrl),
      hashPhone(c.phone),
      hashPhone(c.person.primaryPhone),
    ].filter((v): v is string => Boolean(v));
    if (contactHashes.some((h) => tombstoneSet.has(h))) matchedOn.push("tombstone_hash");

    return {
      contactId: c.id,
      fullName: c.person.fullName,
      email: c.email,
      company: c.company.legalName,
      matchedOn,
    };
  });

  const matchedIds = matchedContacts.map((c) => c.contactId);

  await db.$transaction(async (tx) => {
    await tx.dsarCase.update({
      where: { id: caseId },
      data: {
        matchedContactIds: JSON.stringify(matchedIds),
        matchedCount: matchedIds.length,
        status: "in_progress",
      },
    });

    await tx.dsarAction.create({
      data: {
        caseId,
        actionType: "search_executed",
        actorUserId,
        metadata: JSON.stringify({
          criteria: {
            email: email ?? null,
            phone: phone ?? null,
            linkedinUrl: linkedin ?? null,
            name: name ?? null,
          },
          tombstoneHits: tombstones.length,
          matchedContactIds: matchedIds,
        }),
      },
    });
  });

  return { matchedContacts };
}

export async function exportSubjectData(caseId: string, actorUserId: string): Promise<{
  exportJson: object;
  fileName: string;
}> {
  const dsarCase = await db.dsarCase.findUnique({ where: { id: caseId } });
  if (!dsarCase) throw new Error(`DSAR case ${caseId} not found.`);
  const contactIds = parseIds(dsarCase.matchedContactIds);

  const contacts = contactIds.length
    ? await db.contact.findMany({
        where: { id: { in: contactIds } },
      })
    : [];
  const personIds = [...new Set(contacts.map((c) => c.personId))];
  const companyIds = [...new Set(contacts.map((c) => c.companyId))];

  const [persons, companies, verifications, enrichmentLogs, gateStatusHistory, quarantineLog, mergeHistory] =
    await Promise.all([
      personIds.length ? db.person.findMany({ where: { id: { in: personIds } } }) : [],
      companyIds.length ? db.company.findMany({ where: { id: { in: companyIds } } }) : [],
      contactIds.length ? db.verification.findMany({ where: { contactId: { in: contactIds } } }) : [],
      contactIds.length ? db.enrichmentLog.findMany({ where: { contactId: { in: contactIds } } }) : [],
      contactIds.length ? db.gateStatusHistory.findMany({ where: { contactId: { in: contactIds } } }) : [],
      contactIds.length ? db.quarantineLog.findMany({ where: { contactId: { in: contactIds } } }) : [],
      contactIds.length
        ? db.mergeHistory.findMany({
            where: {
              OR: [{ survivorId: { in: contactIds } }, { mergedFromId: { in: contactIds } }],
            },
          })
        : [],
    ]);

  const suppressions = contactIds.length
    ? await db.suppression.findMany({
        where: {
          OR: [
            { contactId: { in: contactIds } },
            { email: { in: contacts.map((c) => c.email).filter((v): v is string => Boolean(v)) } },
            { domain: { in: companies.map((c) => c.rootDomain) } },
          ],
        },
      })
    : [];

  const auditLog = contactIds.length
    ? await db.auditLog.findMany({
        where: {
          OR: [
            { resourceType: "contact", resourceId: { in: contactIds } },
            { resourceType: "person", resourceId: { in: personIds } },
            { resourceType: "company", resourceId: { in: companyIds } },
            { resourceType: "suppression", resourceId: { in: suppressions.map((s) => s.id) } },
            { resourceType: "quarantine", resourceId: { in: quarantineLog.map((q) => q.id) } },
            { resourceType: "merge", resourceId: { in: mergeHistory.map((m) => m.id) } },
            { resourceType: "dsar", resourceId: caseId },
          ],
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const exportJson = {
    case: dsarCase,
    generatedAt: new Date().toISOString(),
    subjectData: {
      contacts,
      persons,
      companies,
      verifications,
      enrichmentLog: enrichmentLogs,
      gateStatusHistory,
      suppressions,
      quarantineLog,
      mergeHistory,
      auditLog,
    },
  };
  const fileName = `${dsarCase.caseNumber}-export-${yyyymmdd(new Date())}.json`;

  await db.dsarAction.create({
    data: {
      caseId,
      actionType: "data_exported",
      actorUserId,
      metadata: JSON.stringify({
        fileName,
        matchedContacts: contactIds.length,
      }),
    },
  });

  return { exportJson, fileName };
}

export async function executeDsarErasure(caseId: string, actorUserId: string): Promise<{
  contactsHardDeleted: number;
  tombstonesCreated: number;
}> {
  const dsarCase = await db.dsarCase.findUnique({ where: { id: caseId } });
  if (!dsarCase) throw new Error(`DSAR case ${caseId} not found.`);
  if (dsarCase.caseType !== "erasure") {
    throw new Error("executeDsarErasure can only be used for erasure cases.");
  }

  const contactIds = parseIds(dsarCase.matchedContactIds);
  let contactsHardDeleted = 0;
  let tombstonesCreated = 0;

  for (const contactId of contactIds) {
    const result = await hardDeleteContact({
      contactId,
      reason: `DSAR ${dsarCase.caseNumber} erasure request`,
      actorUserId,
      deletionReason: "dsar_article_17",
      dsarCaseId: caseId,
    });
    if (result.contactDeleted) contactsHardDeleted += 1;
    tombstonesCreated += result.tombstonesCreated.length;
  }

  await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.dsarCase.update({
      where: { id: caseId },
      data: {
        tombstoneCreated: true,
        tombstoneCreatedAt: now,
        aiTrainingDatasetNotified: false,
        aiTrainingDatasetAt: null,
        aiSdrPlatformNotified: false,
        aiSdrPlatformAt: null,
        subProcessorsNotified: false,
        subProcessorsAt: null,
        propagationCompletedAt: null,
      },
    });
    await tx.dsarAction.createMany({
      data: [
        {
          caseId,
          actionType: "deletion_executed",
          actorUserId,
          metadata: JSON.stringify({ contactsHardDeleted }),
        },
        {
          caseId,
          actionType: "tombstone_created",
          actorUserId,
          metadata: JSON.stringify({ tombstonesCreated }),
        },
      ],
    });
  });

  return { contactsHardDeleted, tombstonesCreated };
}

export async function confirmPropagation(
  caseId: string,
  target: PropagationTarget,
  actorUserId: string,
): Promise<{ allConfirmed: boolean }> {
  const dsarCase = await db.dsarCase.findUnique({ where: { id: caseId } });
  if (!dsarCase) throw new Error(`DSAR case ${caseId} not found.`);

  const now = new Date();
  const updateData =
    target === "ai_training_dataset"
      ? { aiTrainingDatasetNotified: true, aiTrainingDatasetAt: now }
      : target === "ai_sdr_platform"
        ? { aiSdrPlatformNotified: true, aiSdrPlatformAt: now }
        : { subProcessorsNotified: true, subProcessorsAt: now };

  return db.$transaction(async (tx) => {
    const updated = await tx.dsarCase.update({
      where: { id: caseId },
      data: updateData,
    });
    const allConfirmed =
      updated.tombstoneCreated &&
      updated.aiTrainingDatasetNotified &&
      updated.aiSdrPlatformNotified &&
      updated.subProcessorsNotified;

    await tx.dsarCase.update({
      where: { id: caseId },
      data: {
        propagationCompletedAt: allConfirmed ? now : null,
      },
    });

    await tx.dsarAction.create({
      data: {
        caseId,
        actionType: toActionType(target),
        actorUserId,
      },
    });

    return { allConfirmed };
  });
}

export async function closeDsarCase(
  caseId: string,
  closureReason: string,
  actorUserId: string,
): Promise<void> {
  const reason = closureReason.trim();
  if (!reason) throw new Error("Closure reason is required.");

  const dsarCase = await db.dsarCase.findUnique({ where: { id: caseId } });
  if (!dsarCase) throw new Error(`DSAR case ${caseId} not found.`);
  if (dsarCase.caseType === "erasure" && !dsarCase.propagationCompletedAt) {
    throw new Error(
      "Cannot close erasure case — propagation not complete on all 4 targets.",
    );
  }

  await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.dsarCase.update({
      where: { id: caseId },
      data: {
        status: "completed",
        closedAt: now,
        closureReason: reason,
      },
    });
    await tx.dsarAction.create({
      data: {
        caseId,
        actionType: "case_closed",
        actorUserId,
        metadata: JSON.stringify({ closureReason: reason }),
      },
    });
  });
}
