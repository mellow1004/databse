import { NextRequest, NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { rejectBulkAction } from "@/services/bulkApproval";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { reason?: string };
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim();
  if (!reason) {
    return NextResponse.json({ error: "missing_reason" }, { status: 400 });
  }
  try {
    const actorUserId = await requireDataOwnerActorId();
    await rejectBulkAction(id, actorUserId, reason);
    return NextResponse.json({ rejected: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reject_failed" },
      { status: 400 },
    );
  }
}
