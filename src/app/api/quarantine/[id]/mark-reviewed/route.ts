import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/quarantine/:id/mark-reviewed
 *
 * No body. Moves `reviewState` from `pending` → `reviewed` (idempotent if
 * already `reviewed`). Refuses rows already `released`.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const log = await db.quarantineLog.findUnique({ where: { id } });
    if (!log) {
      return NextResponse.json(
        { error: "not_found", message: `Quarantine log ${id} not found.` },
        { status: 404 },
      );
    }
    if (log.reviewState === "released") {
      return NextResponse.json(
        {
          error: "already_released",
          message: "Cannot mark a released quarantine log as reviewed.",
        },
        { status: 400 },
      );
    }
    if (log.reviewState === "reviewed") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    const dataOwner = await db.user.findFirst({
      where: { role: "data_owner" },
      select: { id: true },
    });
    if (!dataOwner) {
      return NextResponse.json(
        { error: "no_data_owner", message: "No data_owner user found." },
        { status: 500 },
      );
    }

    await db.$transaction(async (tx) => {
      const fresh = await tx.quarantineLog.findUnique({ where: { id } });
      if (!fresh || fresh.reviewState === "released") return;

      const updated = await tx.quarantineLog.updateMany({
        where: { id, reviewState: "pending" },
        data: { reviewState: "reviewed" },
      });
      if (updated.count === 0) return;

      await tx.auditLog.create({
        data: {
          clientId: fresh.clientId,
          actorUserId: dataOwner.id,
          action: "quarantine_marked_reviewed",
          resourceType: "quarantine",
          resourceId: id,
          recordsAffected: 1,
          afterState: JSON.stringify({
            quarantineLogId: id,
            contactId: fresh.contactId,
            reviewState: "reviewed",
          }),
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/quarantine/${id}/mark-reviewed]`, err);
    return NextResponse.json(
      { error: "mark_reviewed_failed", message },
      { status: 500 },
    );
  }
}
