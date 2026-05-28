import { db } from "@/lib/db";

export const BULK_THRESHOLD = 100;

export async function checkBulkApproval(input: {
  actionType: string;
  recordsAffected: number;
  requestorId: string;
  clientId?: string;
  requestPayload?: object;
}): Promise<{ allowed: true } | { allowed: false; pendingApprovalId: string }> {
  if (input.recordsAffected <= BULK_THRESHOLD) {
    return { allowed: true };
  }

  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const approval = await db.bulkActionApproval.create({
    data: {
      clientId: input.clientId ?? null,
      actionType: input.actionType,
      requestedBy: input.requestorId,
      recordsAffected: input.recordsAffected,
      requestPayload: input.requestPayload ? JSON.stringify(input.requestPayload) : null,
      status: "pending",
      expiresAt,
    },
    select: { id: true },
  });

  await db.auditLog.create({
    data: {
      clientId: input.clientId ?? null,
      actorUserId: input.requestorId,
      action: "bulk_approval_requested",
      resourceType: "bulk_action_approval",
      resourceId: approval.id,
      recordsAffected: input.recordsAffected,
      afterState: JSON.stringify({
        actionType: input.actionType,
        threshold: BULK_THRESHOLD,
      }),
    },
  });

  return { allowed: false, pendingApprovalId: approval.id };
}

export async function approveBulkAction(
  approvalId: string,
  approverId: string,
  reason: string,
): Promise<void> {
  const approvalReason = reason.trim();
  if (!approvalReason) throw new Error("Approval reason is required.");
  const row = await db.bulkActionApproval.findUnique({ where: { id: approvalId } });
  if (!row) throw new Error(`BulkActionApproval ${approvalId} not found.`);

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.bulkActionApproval.update({
      where: { id: approvalId },
      data: {
        approvedBy: approverId,
        approvedAt: now,
        approvalReason,
        status: "approved",
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: row.clientId,
        actorUserId: approverId,
        action: "bulk_approval_approved",
        resourceType: "bulk_action_approval",
        resourceId: approvalId,
        recordsAffected: row.recordsAffected,
        afterState: JSON.stringify({ approvalReason }),
      },
    });
  });
}

export async function rejectBulkAction(
  approvalId: string,
  rejectorId: string,
  reason: string,
): Promise<void> {
  const rejectionReason = reason.trim();
  if (!rejectionReason) throw new Error("Rejection reason is required.");
  const row = await db.bulkActionApproval.findUnique({ where: { id: approvalId } });
  if (!row) throw new Error(`BulkActionApproval ${approvalId} not found.`);

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.bulkActionApproval.update({
      where: { id: approvalId },
      data: {
        rejectedBy: rejectorId,
        rejectedAt: now,
        rejectionReason,
        status: "rejected",
      },
    });
    await tx.auditLog.create({
      data: {
        clientId: row.clientId,
        actorUserId: rejectorId,
        action: "bulk_approval_rejected",
        resourceType: "bulk_action_approval",
        resourceId: approvalId,
        recordsAffected: row.recordsAffected,
        afterState: JSON.stringify({ rejectionReason }),
      },
    });
  });
}
