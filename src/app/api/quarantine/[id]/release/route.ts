import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approveQuarantineRelease } from "@/services/quarantine";

/**
 * POST /api/quarantine/:id/release
 *
 * Body: { reason: string } — required, non-empty.
 * Idempotent: if the log is already `reviewState === "released"`, returns 200
 * without mutating or duplicating audit rows.
 *
 * When `contactId` is set and the contact is not soft-merged (`mergedIntoId`
 * is null), clears quarantine, sets `gateStatus` to `gate_1`, bumps
 * `derivedFieldVersion`, appends `GateStatusHistory` only when the gate value
 * changes, and writes `AuditLog` (action `quarantine_released`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const reason = (body.reason ?? "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: "missing_reason", message: "A non-empty release reason is required." },
      { status: 400 },
    );
  }

  try {
    const log = await db.quarantineLog.findUnique({ where: { id } });
    if (!log) {
      return NextResponse.json(
        { error: "not_found", message: `Quarantine log ${id} not found.` },
        { status: 404 },
      );
    }
    if (log.reviewState === "released") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    if (log.contactId) {
      const contact = await db.contact.findUnique({
        where: { id: log.contactId },
        select: { mergedIntoId: true },
      });
      if (contact?.mergedIntoId) {
        return NextResponse.json(
          {
            error: "contact_merged",
            message:
              "This contact has been merged into another record; release is disabled.",
          },
          { status: 400 },
        );
      }
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

    const releasedAt = new Date();
    await approveQuarantineRelease({
      quarantineLogId: id,
      approverId: dataOwner.id,
      approvalReason: reason,
    });

    return NextResponse.json({ ok: true, releasedAt: releasedAt.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/quarantine/${id}/release]`, err);
    return NextResponse.json(
      { error: "release_failed", message },
      { status: 500 },
    );
  }
}
