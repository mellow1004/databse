import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { db } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const actorUserId = await requireDataOwnerActorId();
    const due = new Date();
    due.setMonth(due.getMonth() + 12);

    await db.$transaction(async (tx) => {
      const contact = await tx.contact.update({
        where: { id },
        data: {
          retentionStatus: "active",
          retentionReviewDueAt: due,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId: contact.clientId,
          actorUserId,
          action: "retention_reactivated",
          resourceType: "contact",
          resourceId: id,
          recordsAffected: 1,
          afterState: JSON.stringify({ retentionReviewDueAt: due.toISOString() }),
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reactivate_failed" },
      { status: 400 },
    );
  }
}
