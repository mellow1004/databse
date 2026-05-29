import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { OTTO2_OUTCOMES, recordOtto2CallOutcome, type Otto2Outcome } from "@/services/otto2";

type Body = {
  contactId?: string;
  outcome?: string;
  durationSec?: number;
  callbackScheduledFor?: string;
  sdrUserId?: string;
  notes?: string;
};

export async function POST(req: Request) {
  try {
    const defaultActor = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;

    if (!body.contactId || typeof body.contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (!body.outcome || typeof body.outcome !== "string") {
      return NextResponse.json({ error: "outcome is required" }, { status: 400 });
    }
    if (!(OTTO2_OUTCOMES as readonly string[]).includes(body.outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${OTTO2_OUTCOMES.join(", ")}` },
        { status: 400 },
      );
    }

    const sdrUserId =
      typeof body.sdrUserId === "string" && body.sdrUserId.trim()
        ? body.sdrUserId.trim()
        : defaultActor;

    let callbackScheduledFor: Date | undefined;
    if (body.callbackScheduledFor) {
      callbackScheduledFor = new Date(body.callbackScheduledFor);
      if (Number.isNaN(callbackScheduledFor.getTime())) {
        return NextResponse.json(
          { error: "callbackScheduledFor must be a valid ISO date" },
          { status: 400 },
        );
      }
    }

    const result = await recordOtto2CallOutcome({
      contactId: body.contactId,
      outcome: body.outcome as Otto2Outcome,
      durationSec:
        typeof body.durationSec === "number" ? body.durationSec : undefined,
      callbackScheduledFor,
      sdrUserId,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "internal_error";
    if (
      msg.includes("not found") ||
      msg.includes("soft-archived") ||
      msg.includes("callbackScheduledFor")
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
