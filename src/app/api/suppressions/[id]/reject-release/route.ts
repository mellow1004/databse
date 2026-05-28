import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rejectSuppressionRelease } from "@/services/suppression";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { rejectionReason?: string };
  try {
    body = (await req.json()) as { rejectionReason?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const rejectionReason = (body.rejectionReason ?? "").trim();
  if (!rejectionReason) {
    return NextResponse.json(
      { error: "missing_rejection_reason", message: "rejectionReason is required." },
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
    await rejectSuppressionRelease({
      suppressionId: id,
      actorUserId: dataOwner.id,
      rejectionReason,
    });
    return NextResponse.json({ rejected: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "reject_release_failed", message },
      { status: 400 },
    );
  }
}
