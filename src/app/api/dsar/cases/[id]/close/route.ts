import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { closeDsarCase } from "@/services/dsar";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { closureReason?: string };
  try {
    body = (await req.json()) as { closureReason?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const closureReason = (body.closureReason ?? "").trim();
  if (!closureReason) {
    return NextResponse.json(
      { error: "missing_closure_reason", message: "closureReason is required." },
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

    await closeDsarCase(id, closureReason, dataOwner.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const clientError = message.toLowerCase().includes("cannot close erasure case");
    return NextResponse.json(
      { error: "close_dsar_case_failed", message },
      { status: clientError ? 400 : 500 },
    );
  }
}
