import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { registerBounceEvent } from "@/services/aiSdrEvents";

type Body = {
  contactId?: string;
  bounceType?: string;
  bounceReason?: string;
};

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    if (!body.contactId || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (body.bounceType !== "hard" && body.bounceType !== "soft" && body.bounceType !== "block") {
      return NextResponse.json(
        { error: "bounceType must be hard | soft | block" },
        { status: 400 },
      );
    }

    const result = await registerBounceEvent({
      contactId: body.contactId,
      bounceType: body.bounceType,
      bounceReason: typeof body.bounceReason === "string" ? body.bounceReason : undefined,
      actorUserId,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "internal_error";
    if (msg.includes("not found") || msg.includes("soft-archived")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
