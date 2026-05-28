import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const row = await db.refreshLog.findUnique({
      where: { id },
      select: { id: true, status: true, notes: true, startedAt: true, completedAt: true },
    });
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    let parsedNotes: unknown = null;
    if (row.notes) {
      try {
        parsedNotes = JSON.parse(row.notes);
      } catch {
        parsedNotes = null;
      }
    }
    return NextResponse.json({
      id: row.id,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      progress: parsedNotes,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
