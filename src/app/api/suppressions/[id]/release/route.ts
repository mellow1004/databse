import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/suppressions/:id/release
 *
 * Body: { reason: string }
 *
 * Releasing a suppression is a sensitive action — it potentially re-opens
 * outreach to a person/domain that was previously off-limits. Always logged.
 * Released rows are kept (never deleted) for historical traceability.
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
    const row = await db.suppression.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json(
        { error: "not_found", message: `Suppression ${id} not found.` },
        { status: 404 },
      );
    }
    if (row.releaseStatus !== "active") {
      return NextResponse.json(
        {
          error: "already_released",
          message: `Suppression ${id} is already in status '${row.releaseStatus}'.`,
        },
        { status: 400 },
      );
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
    await db.$transaction(async (tx) => {
      await tx.suppression.update({
        where: { id },
        data: {
          releaseStatus: "released",
          releasedAt,
          releasedBy: dataOwner.id,
          releaseReason: reason,
        },
      });
      await tx.auditLog.create({
        data: {
          clientId: row.clientId,
          actorUserId: dataOwner.id,
          action: "suppression_released",
          resourceType: "suppression",
          resourceId: id,
          beforeState: JSON.stringify({
            scope: row.scope,
            reasonCode: row.reasonCode,
            isOptOut: row.isOptOut,
            contactId: row.contactId,
            email: row.email,
            domain: row.domain,
          }),
          afterState: JSON.stringify({ releaseStatus: "released", reason }),
        },
      });
    });

    return NextResponse.json({ released: true, releasedAt: releasedAt.toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/suppressions/${id}/release]`, err);
    return NextResponse.json(
      { error: "release_failed", message },
      { status: 500 },
    );
  }
}
