import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestSuppressionRelease } from "@/services/suppression";

/**
 * POST /api/suppressions/:id/release
 *
 * Body: { reason: string, regulatoryReviewNotes?: string }
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
  let body: {
    reason?: string;
    regulatoryReviewReference?: string;
    confirmationChecked?: boolean;
  };
  try {
    body = (await req.json()) as {
      reason?: string;
      regulatoryReviewReference?: string;
      confirmationChecked?: boolean;
    };
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

    const out = await requestSuppressionRelease({
      suppressionId: id,
      reason,
      requestorId: dataOwner.id,
      regulatoryReviewReference: body.regulatoryReviewReference,
      confirmationChecked: body.confirmationChecked,
    });
    if (out.status === "request_pending") {
      return NextResponse.json(
        {
          status: "request_pending",
          message: "Release request created and awaiting Data Owner approval.",
        },
        { status: 202 },
      );
    }
    return NextResponse.json({ status: "released_directly" }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/suppressions/${id}/release]`, err);
    return NextResponse.json(
      { error: "release_failed", message },
      { status: 500 },
    );
  }
}
