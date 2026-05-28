import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
        action: "bias_investigation_opened",
        resourceType: "bias_monitoring",
        resourceId: String(body?.category ?? "unknown"),
        recordsAffected: 1,
        afterState: JSON.stringify({
          subgroup: body?.subgroup ?? null,
          contacts: body?.contacts ?? null,
          rate: body?.rate ?? null,
          deltaPp: body?.deltaPp ?? null,
          createdAt: new Date().toISOString(),
        }),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "investigation_failed", message }, { status: 500 });
  }
}
