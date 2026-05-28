import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = await db.refreshLog.findUnique({
    where: { id },
    select: { id: true, cycleNumber: true, notes: true },
  });
  if (!row) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = row.notes ? row.notes : JSON.stringify({ id: row.id, cycleNumber: row.cycleNumber });
  return new Response(payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="refresh-cycle-${row.cycleNumber}.json"`,
    },
  });
}
