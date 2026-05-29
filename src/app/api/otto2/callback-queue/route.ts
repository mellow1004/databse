import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { getOtto2CallbackQueue } from "@/services/otto2";

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
    const callbacks = await getOtto2CallbackQueue(clientId);
    return NextResponse.json({ callbacks });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
