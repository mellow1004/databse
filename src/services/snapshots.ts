import { db } from "@/lib/db";

export async function captureSnapshot(input: {
  batchId: string;
  batchType:
    | "enrichment"
    | "refresh_cycle"
    | "import_promotion"
    | "merge"
    | "bulk_suppression";
  records: Array<{ recordType: "contact" | "company"; recordId: string; data: object }>;
}): Promise<void> {
  if (input.records.length === 0) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.batchSnapshot.createMany({
    data: input.records.map((r) => ({
      batchId: input.batchId,
      batchType: input.batchType,
      recordType: r.recordType,
      recordId: r.recordId,
      preWriteState: JSON.stringify(r.data),
      createdAt: now,
      expiresAt,
    })),
  });
}

export async function rollbackBatch(input: {
  batchId: string;
  actorUserId: string;
  reason: string;
  allowOverride?: boolean;
}): Promise<{ recordsRestored: number; recordsSkipped: number }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("rollback reason is required");
  }

  const snapshots = await db.batchSnapshot.findMany({
    where: { batchId: input.batchId },
    orderBy: { createdAt: "asc" },
  });
  if (snapshots.length === 0) {
    return { recordsRestored: 0, recordsSkipped: 0 };
  }

  const earliest = snapshots[0]!;
  const elapsedMs = Date.now() - earliest.createdAt.getTime();
  if (elapsedMs > 24 * 60 * 60 * 1000 && input.allowOverride !== true) {
    throw new Error("rollback_requires_gtme_review");
  }

  let recordsRestored = 0;
  let recordsSkipped = 0;

  for (const snapshot of snapshots) {
    try {
      const preWrite = JSON.parse(snapshot.preWriteState) as Record<string, unknown>;
      if (snapshot.recordType === "contact") {
        await db.contact.update({
          where: { id: snapshot.recordId },
          data: preWrite,
        });
      } else if (snapshot.recordType === "company") {
        await db.company.update({
          where: { id: snapshot.recordId },
          data: preWrite,
        });
      } else {
        recordsSkipped += 1;
        continue;
      }
      recordsRestored += 1;
      await db.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "rollback_record_restored",
          resourceType: snapshot.recordType,
          resourceId: snapshot.recordId,
          batchId: input.batchId,
          recordsAffected: 1,
          afterState: JSON.stringify({
            reason,
            batchType: snapshot.batchType,
            restoredFromSnapshotAt: snapshot.createdAt.toISOString(),
          }),
        },
      });
    } catch {
      recordsSkipped += 1;
    }
  }

  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "rollback_batch_completed",
      resourceType: "batch_snapshot",
      resourceId: input.batchId,
      batchId: input.batchId,
      recordsAffected: recordsRestored,
      afterState: JSON.stringify({
        reason,
        allowOverride: input.allowOverride === true,
        recordsRestored,
        recordsSkipped,
      }),
    },
  });

  return { recordsRestored, recordsSkipped };
}
