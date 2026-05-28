import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { confirmPropagation } from "@/services/dsar";

const TARGETS = new Set(["ai_training_dataset", "ai_sdr_platform", "sub_processors"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { target?: string };
  try {
    body = (await req.json()) as { target?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!body.target || !TARGETS.has(body.target)) {
    return NextResponse.json(
      {
        error: "invalid_target",
        message: "target must be one of ai_training_dataset, ai_sdr_platform, sub_processors.",
      },
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
    const out = await confirmPropagation(
      id,
      body.target as "ai_training_dataset" | "ai_sdr_platform" | "sub_processors",
      dataOwner.id,
    );
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "confirm_propagation_failed", message },
      { status: 500 },
    );
  }
}
