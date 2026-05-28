import { db } from "@/lib/db";

const DERIVED_FIELD_VERSION = "v1";

export async function approveQuarantineRelease(input: {
  quarantineLogId: string;
  approverId: string;
  approvalReason: string;
}): Promise<void> {
  const reason = input.approvalReason.trim();
  if (!reason) throw new Error("approvalReason is required.");

  const log = await db.quarantineLog.findUnique({ where: { id: input.quarantineLogId } });
  if (!log) throw new Error(`Quarantine log ${input.quarantineLogId} not found.`);
  if (log.reviewState === "released") return;

  if (log.contactId) {
    const contact = await db.contact.findUnique({
      where: { id: log.contactId },
      select: { mergedIntoId: true },
    });
    if (contact?.mergedIntoId) {
      throw new Error("This contact has been merged into another record; release is disabled.");
    }
  }

  const releasedAt = new Date();
  const targetGate = log.proposedRestoredGate ?? "gate_1";

  await db.$transaction(async (tx) => {
    const fresh = await tx.quarantineLog.findUnique({ where: { id: input.quarantineLogId } });
    if (!fresh || fresh.reviewState === "released") return;

    await tx.quarantineLog.update({
      where: { id: input.quarantineLogId },
      data: {
        reviewState: "released",
        releasedAt,
        releasedBy: input.approverId,
        releaseReason: reason,
        approvalRequestedBy: fresh.approvalRequestedBy ?? input.approverId,
        approvalRequestedAt: fresh.approvalRequestedAt ?? releasedAt,
      },
    });

    if (fresh.contactId) {
      const contact = await tx.contact.findUnique({
        where: { id: fresh.contactId },
        select: { id: true, clientId: true, gateStatus: true, mergedIntoId: true },
      });
      if (contact && !contact.mergedIntoId) {
        const previous = contact.gateStatus;
        await tx.contact.update({
          where: { id: contact.id },
          data: {
            quarantineReason: null,
            gateStatus: targetGate,
            derivedFieldVersion: DERIVED_FIELD_VERSION,
          },
        });
        if (previous !== targetGate) {
          await tx.gateStatusHistory.create({
            data: {
              clientId: contact.clientId,
              contactId: contact.id,
              fromGate: previous,
              toGate: targetGate,
              reason: "quarantine_released",
              actor: input.approverId,
              derivedFieldVersion: DERIVED_FIELD_VERSION,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          clientId: fresh.clientId,
          actorUserId: input.approverId,
          action: "quarantine_release_approved",
          resourceType: "contact",
          resourceId: fresh.contactId,
          recordsAffected: 1,
          afterState: JSON.stringify({
            quarantineLogId: input.quarantineLogId,
            approvalReason: reason,
            releasedAt: releasedAt.toISOString(),
            gateStatus: targetGate,
          }),
        },
      });
    }
  });
}
