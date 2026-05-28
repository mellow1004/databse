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
    await db.$transaction(async (tx) => {
      const contact = await tx.contact.update({
        where: { id },
        data: { retentionStatus: "anonymisation_queued" },
      });
      await tx.auditLog.create({
        data: {
          clientId: contact.clientId,
          actorUserId,
          action: "retention_anonymisation_queued",
          resourceType: "contact",
          resourceId: id,
          recordsAffected: 1,
        },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "queue_failed" },
      { status: 400 },
    );
  }
}
