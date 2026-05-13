import { db } from "@/lib/db";
import { evaluateAndApplyBulk } from "@/services/gates";
import { normalizeEmail } from "@/lib/normalization";

export type CampaignAssignmentInput = {
  contactIds: string[];
  campaignLabel: string;
  actorUserId: string;
};

export type BounceEventInput = {
  contactId: string;
  bounceType: "hard" | "soft" | "block";
  bounceReason?: string;
  actorUserId: string;
};

export type ReplyEventInput = {
  contactId: string;
  replyType: "positive" | "negative" | "stop" | "neutral";
  replyText?: string;
  actorUserId: string;
};

export async function assignToCampaign(
  input: CampaignAssignmentInput,
): Promise<{
  assigned: number;
  skipped: number;
  errors: { contactId: string; reason: string }[];
}> {
  const errors: { contactId: string; reason: string }[] = [];
  const toAssign: string[] = [];
  const uniqueIds = [...new Set(input.contactIds)];

  for (const contactId of uniqueIds) {
    const c = await db.contact.findUnique({
      where: { id: contactId },
      select: {
        mergedIntoId: true,
        quarantineReason: true,
        campaignActive: true,
      },
    });
    if (!c) {
      errors.push({ contactId, reason: "not_found" });
      continue;
    }
    if (c.mergedIntoId) {
      errors.push({ contactId, reason: "soft_archived" });
      continue;
    }
    if (c.quarantineReason) {
      errors.push({ contactId, reason: "quarantined" });
      continue;
    }
    if (c.campaignActive) {
      errors.push({ contactId, reason: "already_in_active_campaign" });
      continue;
    }
    toAssign.push(contactId);
  }

  if (toAssign.length === 0) {
    await db.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "campaign_assigned",
        resourceType: "ai_sdr_campaign",
        recordsAffected: 0,
        afterState: JSON.stringify({
          campaignLabel: input.campaignLabel,
          contactIds: [],
        }),
      },
    });
    return { assigned: 0, skipped: errors.length, errors };
  }

  const firstClient = await db.contact.findUnique({
    where: { id: toAssign[0]! },
    select: { clientId: true },
  });

  await db.$transaction(async (tx) => {
    for (const id of toAssign) {
      await tx.contact.update({
        where: { id },
        data: {
          campaignActive: true,
          writeSource: "ai_sdr_platform",
        },
      });
    }
    await tx.auditLog.create({
      data: {
        clientId: firstClient?.clientId,
        actorUserId: input.actorUserId,
        action: "campaign_assigned",
        resourceType: "ai_sdr_campaign",
        recordsAffected: toAssign.length,
        afterState: JSON.stringify({
          campaignLabel: input.campaignLabel,
          contactIds: toAssign,
        }),
      },
    });
  });

  return {
    assigned: toAssign.length,
    skipped: errors.length,
    errors,
  };
}

export async function registerBounceEvent(input: BounceEventInput): Promise<{
  contactId: string;
  gateDowngraded: boolean;
  quarantined: boolean;
  campaignDeactivated: boolean;
}> {
  const status = input.bounceType === "hard" ? "invalid" : "risky";
  let clientIdForAudit: string | undefined;

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true, clientId: true, mergedIntoId: true },
    });
    if (!contact) {
      throw new Error(`contact ${input.contactId} not found`);
    }
    if (contact.mergedIntoId) {
      throw new Error(`contact ${input.contactId} is soft-archived`);
    }
    clientIdForAudit = contact.clientId;

    await tx.verification.create({
      data: {
        clientId: contact.clientId,
        contactId: input.contactId,
        verificationType: "email",
        provider: "ai_sdr_platform",
        status,
        confidence: 0.99,
        creditsUsed: 0,
        rawResponse: JSON.stringify({
          bounceType: input.bounceType,
          bounceReason: input.bounceReason ?? null,
          source: "ai_sdr_test",
        }),
      },
    });

    await tx.contact.update({
      where: { id: input.contactId },
      data: {
        campaignActive: false,
        lastVerifiedAt: new Date(),
      },
    });
  });

  const bulk = await evaluateAndApplyBulk([input.contactId], input.actorUserId);
  const ev = bulk.evaluations[0];
  const gateDowngraded =
    bulk.downgraded > 0 && ev?.decision === "downgrade" && ev.proposedGate === "gate_1";
  const quarantined = bulk.quarantined > 0;

  await db.auditLog.create({
    data: {
      clientId: clientIdForAudit,
      actorUserId: input.actorUserId,
      action: "bounce_event_received",
      resourceType: "contact",
      resourceId: input.contactId,
      recordsAffected: 1,
      afterState: JSON.stringify({
        bounceType: input.bounceType,
        bounceReason: input.bounceReason ?? null,
        gateEvaluation: {
          downgraded: bulk.downgraded,
          quarantined: bulk.quarantined,
          decision: ev?.decision ?? null,
          reason: ev?.reason ?? null,
        },
      }),
    },
  });

  return {
    contactId: input.contactId,
    gateDowngraded,
    quarantined,
    campaignDeactivated: true,
  };
}

export async function registerReplyEvent(input: ReplyEventInput): Promise<{
  contactId: string;
  campaignDeactivated: boolean;
  suppressionCreated: boolean;
  suppressionId?: string;
}> {
  let suppressionId: string | undefined;

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: input.contactId },
      include: { person: { select: { primaryEmail: true } } },
    });
    if (!contact) {
      throw new Error(`contact ${input.contactId} not found`);
    }
    if (contact.mergedIntoId) {
      throw new Error(`contact ${input.contactId} is soft-archived`);
    }

    await tx.contact.update({
      where: { id: input.contactId },
      data: { campaignActive: false },
    });

    if (input.replyType === "stop") {
      const rawEmail = contact.email ?? contact.person.primaryEmail ?? null;
      const emailNorm = normalizeEmail(rawEmail);
      const reasonDetail = input.replyText
        ? `${input.replyText}\nai_sdr_test`
        : "ai_sdr_test";

      const created = await tx.suppression.create({
        data: {
          scope: "client_level",
          clientId: contact.clientId,
          contactId: contact.id,
          email: emailNorm,
          reasonCode: "stop_reply",
          reasonDetail,
          owner: input.actorUserId,
          source: "ai_sdr_platform",
          isOptOut: true,
          coolingPeriodIndefinite: true,
        },
      });
      suppressionId = created.id;
    }

    await tx.auditLog.create({
      data: {
        clientId: contact.clientId,
        actorUserId: input.actorUserId,
        action: "reply_event_received",
        resourceType: "contact",
        resourceId: input.contactId,
        recordsAffected: 1,
        afterState: JSON.stringify({
          replyType: input.replyType,
          replyText: input.replyText ?? null,
          suppressionId: suppressionId ?? null,
        }),
      },
    });
  });

  return {
    contactId: input.contactId,
    campaignDeactivated: true,
    suppressionCreated: input.replyType === "stop",
    suppressionId,
  };
}
