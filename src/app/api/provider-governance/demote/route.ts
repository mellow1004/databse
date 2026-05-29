import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { db } from "@/lib/db";

type Body = {
  provider?: string;
  cycleNumber?: number;
  accuracyRate?: number;
  reviewType?: string;
};

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    if (!body.provider || typeof body.provider !== "string") {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const isDemotionReview = body.reviewType === "demotion_review";
    await db.auditLog.create({
      data: {
        actorUserId,
        action: isDemotionReview
          ? "provider_demotion_review_opened"
          : "provider_waterfall_demote_requested",
        resourceType: "provider_governance",
        resourceId: body.provider,
        recordsAffected: 1,
        afterState: JSON.stringify({
          provider: body.provider,
          cycleNumber: body.cycleNumber ?? null,
          accuracyRate: body.accuracyRate ?? null,
          mode: isDemotionReview ? "demotion_review" : "demo_stub",
        }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
