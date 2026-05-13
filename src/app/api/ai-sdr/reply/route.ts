import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { registerReplyEvent } from "@/services/aiSdrEvents";

type Body = {
  contactId?: string;
  replyType?: string;
  replyText?: string;
};

const REPLY_TYPES = new Set(["positive", "negative", "stop", "neutral"]);

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    if (!body.contactId || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (!body.replyType || !REPLY_TYPES.has(body.replyType)) {
      return NextResponse.json(
        { error: "replyType must be positive | negative | stop | neutral" },
        { status: 400 },
      );
    }

    const result = await registerReplyEvent({
      contactId: body.contactId,
      replyType: body.replyType as "positive" | "negative" | "stop" | "neutral",
      replyText: typeof body.replyText === "string" ? body.replyText : undefined,
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
