import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { getOtto2Prospects } from "@/services/otto2";

export async function GET(req: Request) {
  try {
    await requireDataOwnerActorId();
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const prospects = await getOtto2Prospects({ clientId, limit });
    return NextResponse.json({ prospects });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
