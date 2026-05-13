import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { drawAccuracySample } from "@/services/accuracy";

const ALLOWED = new Set(["cognism", "apollo"]);

export async function POST(req: NextRequest) {
  let body: { clientId?: string; provider?: string; cycleNumber?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const clientId = body.clientId?.trim();
  const provider = body.provider?.trim()?.toLowerCase();
  const cycleNumber = body.cycleNumber;

  if (!clientId) {
    return NextResponse.json(
      { error: "missing_client_id", message: "clientId is required." },
      { status: 400 },
    );
  }
  if (!provider || !ALLOWED.has(provider)) {
    return NextResponse.json(
      { error: "invalid_provider", message: "provider must be cognism or apollo." },
      { status: 400 },
    );
  }
  if (typeof cycleNumber !== "number" || !Number.isInteger(cycleNumber) || cycleNumber < 0) {
    return NextResponse.json(
      { error: "invalid_cycle", message: "cycleNumber must be a non-negative integer." },
      { status: 400 },
    );
  }

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return NextResponse.json(
      { error: "client_not_found", message: `Client ${clientId} not found.` },
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

  try {
    const out = await drawAccuracySample({
      clientId,
      provider,
      cycleNumber,
      actorUserId: dataOwner.id,
    });
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/accuracy/draw]", err);
    return NextResponse.json({ error: "draw_failed", message }, { status: 500 });
  }
}
