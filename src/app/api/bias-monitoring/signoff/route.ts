import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const notes = String(body?.notes ?? "").trim();
    const summary = body?.summary ?? {};
    const dataOwner = await db.user.findFirst({
      where: { role: "data_owner" },
      select: { id: true },
    });
    if (!dataOwner) {
      return NextResponse.json({ error: "no_data_owner" }, { status: 500 });
    }
    await db.auditLog.create({
      data: {
        actorUserId: dataOwner.id,
        action: "bias_review_signed_off",
        resourceType: "bias_monitoring",
        resourceId: "quarterly",
        recordsAffected: 1,
        afterState: JSON.stringify({
          notes,
          summary,
          signedAt: new Date().toISOString(),
        }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "signoff_failed", message }, { status: 500 });
  }
}
