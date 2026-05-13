import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordSampleReview } from "@/services/accuracy";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { isCorrect?: boolean; actualValue?: string; notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof body.isCorrect !== "boolean") {
    return NextResponse.json(
      { error: "missing_is_correct", message: "isCorrect (boolean) is required." },
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

  const existing = await db.accuracySample.findUnique({
    where: { id },
    select: { reviewedAt: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "not_found", message: `Accuracy sample ${id} not found.` },
      { status: 404 },
    );
  }
  if (existing.reviewedAt !== null) {
    return NextResponse.json(
      { error: "already_reviewed", message: "This sample has already been reviewed." },
      { status: 400 },
    );
  }

  try {
    await recordSampleReview({
      sampleRowId: id,
      isCorrect: body.isCorrect,
      actualValue: body.actualValue,
      notes: body.notes,
      reviewerId: dataOwner.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/accuracy/${id}/review]`, err);
    return NextResponse.json({ error: "review_failed", message }, { status: 500 });
  }
}
