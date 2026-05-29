import { db } from "@/lib/db";
import { findContactIdsAffectedBySuppression } from "@/services/suppression";
import { filterTargetableContacts } from "@/services/suppression";

export const OTTO2_OUTCOMES = [
  "no_answer",
  "callback",
  "qualified_interview",
  "decline",
  "wrong_number",
  "answer_no_interview",
] as const;

export type Otto2Outcome = (typeof OTTO2_OUTCOMES)[number];

export type Otto2Prospect = {
  contactId: string;
  fullName: string;
  phone: string;
  company: string;
  totalCallAttempts: number;
  lastCalledAt: Date | null;
};

export type Otto2CallbackRow = {
  id: string;
  contactId: string;
  fullName: string;
  phone: string | null;
  company: string;
  scheduledFor: Date;
  notes: string | null;
  createdFromCallId: string | null;
};

function isOtto2Outcome(value: string): value is Otto2Outcome {
  return (OTTO2_OUTCOMES as readonly string[]).includes(value);
}

export async function getOtto2Prospects(input: {
  clientId: string;
  limit?: number;
}): Promise<Otto2Prospect[]> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 50));

  const contacts = await db.contact.findMany({
    where: {
      clientId: input.clientId,
      gateStatus: "gate_2",
      mergedIntoId: null,
      phoneVerified: true,
      phone: { not: null },
      lifecycleStage: "active",
    },
    select: {
      id: true,
      phone: true,
      totalCallAttempts: true,
      person: { select: { fullName: true } },
      company: { select: { legalName: true } },
    },
  });

  const withPhone = contacts.filter((c) => c.phone && c.phone.trim().length > 0);
  const targetableIds = await filterTargetableContacts(
    withPhone.map((c) => c.id),
    input.clientId,
  );
  const targetableSet = new Set(targetableIds);
  const eligible = withPhone.filter((c) => targetableSet.has(c.id));

  if (eligible.length === 0) return [];

  const lastCalls = await db.otto2Call.groupBy({
    by: ["contactId"],
    where: { contactId: { in: eligible.map((c) => c.id) } },
    _max: { calledAt: true },
  });
  const lastCalledByContact = new Map(
    lastCalls.map((r) => [r.contactId, r._max.calledAt]),
  );

  const ranked = eligible
    .map((c) => ({
      contactId: c.id,
      fullName: c.person.fullName,
      phone: c.phone!,
      company: c.company.legalName,
      totalCallAttempts: c.totalCallAttempts,
      lastCalledAt: lastCalledByContact.get(c.id) ?? null,
    }))
    .sort((a, b) => {
      if (a.totalCallAttempts !== b.totalCallAttempts) {
        return a.totalCallAttempts - b.totalCallAttempts;
      }
      if (a.lastCalledAt === null && b.lastCalledAt === null) return 0;
      if (a.lastCalledAt === null) return -1;
      if (b.lastCalledAt === null) return 1;
      return a.lastCalledAt.getTime() - b.lastCalledAt.getTime();
    });

  return ranked.slice(0, limit).map((row) => ({
    contactId: row.contactId,
    fullName: row.fullName,
    phone: row.phone,
    company: row.company,
    totalCallAttempts: row.totalCallAttempts,
    lastCalledAt: row.lastCalledAt,
  }));
}

export async function getOtto2CallbackQueue(clientId: string): Promise<Otto2CallbackRow[]> {
  const rows = await db.otto2CallbackQueue.findMany({
    where: { clientId, status: "pending" },
    orderBy: { scheduledFor: "asc" },
    take: 200,
  });

  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const contacts = await db.contact.findMany({
    where: { id: { in: contactIds } },
    select: {
      id: true,
      phone: true,
      person: { select: { fullName: true } },
      company: { select: { legalName: true } },
    },
  });
  const byId = new Map(contacts.map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = byId.get(r.contactId);
    return {
      id: r.id,
      contactId: r.contactId,
      fullName: c?.person.fullName ?? "Unknown",
      phone: c?.phone ?? null,
      company: c?.company.legalName ?? "—",
      scheduledFor: r.scheduledFor,
      notes: r.notes,
      createdFromCallId: r.createdFromCallId,
    };
  });
}

export async function recordOtto2CallOutcome(input: {
  contactId: string;
  outcome: Otto2Outcome;
  durationSec?: number;
  callbackScheduledFor?: Date;
  sdrUserId: string;
  notes?: string;
}): Promise<{
  callId: string;
  quarantineCreated: boolean;
  suppressionCreated: boolean;
}> {
  if (!isOtto2Outcome(input.outcome)) {
    throw new Error(`Invalid outcome: ${input.outcome}`);
  }
  if (input.outcome === "callback" && !input.callbackScheduledFor) {
    throw new Error("callbackScheduledFor is required when outcome is callback");
  }

  let callId = "";
  let quarantineCreated = false;
  let suppressionCreated = false;

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.findUnique({
      where: { id: input.contactId },
      include: {
        person: { select: { primaryEmail: true, fullName: true } },
      },
    });
    if (!contact) {
      throw new Error(`contact ${input.contactId} not found`);
    }
    if (contact.mergedIntoId) {
      throw new Error(`contact ${input.contactId} is soft-archived`);
    }

    const call = await tx.otto2Call.create({
      data: {
        contactId: contact.id,
        clientId: contact.clientId,
        sdrUserId: input.sdrUserId,
        outcome: input.outcome,
        durationSec: input.durationSec ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });
    callId = call.id;

    await tx.contact.update({
      where: { id: contact.id },
      data: { totalCallAttempts: { increment: 1 } },
    });

    if (input.outcome === "callback" && input.callbackScheduledFor) {
      await tx.otto2CallbackQueue.create({
        data: {
          contactId: contact.id,
          clientId: contact.clientId,
          scheduledFor: input.callbackScheduledFor,
          status: "pending",
          createdFromCallId: call.id,
          notes: input.notes ?? null,
        },
      });
    }

    if (input.outcome === "wrong_number") {
      await tx.quarantineLog.create({
        data: {
          clientId: contact.clientId,
          contactId: contact.id,
          reasonCode: "wrong_number",
          reasonDetail: input.notes ?? "Otto 2 wrong number outcome",
          actor: input.sdrUserId,
          reviewState: "pending",
          previousGate: contact.gateStatus,
          proposedRestoredGate: "gate_1",
          approvalPath: "manual",
        },
      });
      await tx.contact.update({
        where: { id: contact.id },
        data: { quarantineReason: "wrong_number" },
      });
      quarantineCreated = true;
    }

    if (input.outcome === "decline") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const priorDeclines = await tx.otto2Call.count({
        where: {
          contactId: contact.id,
          outcome: "decline",
          calledAt: { gte: thirtyDaysAgo },
          id: { not: call.id },
        },
      });
      if (priorDeclines >= 1) {
        const email =
          contact.email?.trim().toLowerCase() ??
          contact.person.primaryEmail?.trim().toLowerCase() ??
          null;
        await tx.suppression.create({
          data: {
            scope: "client_level",
            clientId: contact.clientId,
            contactId: contact.id,
            email,
            reasonCode: "explicit_decline",
            reasonDetail:
              input.notes ??
              "Second explicit decline within 30 days (Otto 2)",
            owner: input.sdrUserId,
            source: "ai_sdr_platform",
            isOptOut: true,
            coolingPeriodIndefinite: true,
          },
        });
        suppressionCreated = true;
      }
    }

    await tx.auditLog.create({
      data: {
        clientId: contact.clientId,
        actorUserId: input.sdrUserId === "system" ? null : input.sdrUserId,
        action: "otto2_call_recorded",
        resourceType: "contact",
        resourceId: contact.id,
        recordsAffected: 1,
        afterState: JSON.stringify({
          callId: call.id,
          outcome: input.outcome,
          durationSec: input.durationSec ?? null,
          callbackScheduledFor: input.callbackScheduledFor?.toISOString() ?? null,
          quarantineCreated,
          suppressionCreated,
        }),
      },
    });
  });

  return { callId, quarantineCreated, suppressionCreated };
}

/** Cancel pending Otto 2 callbacks when a suppression would block those contacts. */
export async function cancelOtto2CallbacksForSuppression(
  suppression: {
    id: string;
    scope: string;
    clientId: string | null;
    contactId: string | null;
    email: string | null;
    domain: string | null;
  },
  actorUserId: string,
): Promise<number> {
  const contactIds = await findContactIdsAffectedBySuppression(suppression);
  if (contactIds.length === 0) return 0;

  const result = await db.otto2CallbackQueue.updateMany({
    where: { contactId: { in: contactIds }, status: "pending" },
    data: { status: "cancelled" },
  });

  if (result.count > 0) {
    await db.auditLog.create({
      data: {
        clientId: suppression.clientId,
        actorUserId,
        action: "otto2_callbacks_cancelled_by_suppression",
        resourceType: "suppression",
        resourceId: suppression.id,
        recordsAffected: result.count,
        afterState: JSON.stringify({
          cancelledCount: result.count,
          contactIdsAffected: contactIds.length,
        }),
      },
    });
  }

  return result.count;
}
