import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approveSuppressionRelease } from "@/services/suppression";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { approvalReason?: string; regulatoryReviewNotes?: string };
  try {
    body = (await req.json()) as { approvalReason?: string; regulatoryReviewNotes?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const approvalReason = (body.approvalReason ?? "").trim();
  if (!approvalReason) {
    return NextResponse.json(
      { error: "missing_approval_reason", message: "approvalReason is required." },
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

    await approveSuppressionRelease({
      suppressionId: id,
      approverId: dataOwner.id,
      approvalReason,
      regulatoryReviewNotes: body.regulatoryReviewNotes,
    });
    return NextResponse.json({ approved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const clientError =
      message.toLowerCase().includes("not found") ||
      message.toLowerCase().includes("required") ||
      message.toLowerCase().includes("awaiting approval");
    return NextResponse.json(
      { error: "approve_release_failed", message },
      { status: clientError ? 400 : 500 },
    );
  }
}
