import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { rollbackBatch } from "@/services/snapshots";

type Body = {
  reason?: string;
  allowOverride?: boolean;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await ctx.params;
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    const result = await rollbackBatch({
      batchId,
      actorUserId,
      reason: body.reason ?? "",
      allowOverride: body.allowOverride === true,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal_error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
