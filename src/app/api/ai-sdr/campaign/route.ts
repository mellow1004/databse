import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { assignToCampaign } from "@/services/aiSdrEvents";

type Body = {
  contactIds?: string[];
  campaignLabel?: string;
};

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    if (!Array.isArray(body.contactIds)) {
      return NextResponse.json({ error: "contactIds must be an array" }, { status: 400 });
    }
    if (!body.campaignLabel || typeof body.campaignLabel !== "string") {
      return NextResponse.json({ error: "campaignLabel is required" }, { status: 400 });
    }

    const result = await assignToCampaign({
      contactIds: body.contactIds,
      campaignLabel: body.campaignLabel,
      actorUserId,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
