import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promoteBatch } from "@/services/promotion";

/**
 * POST /api/intake/batches/:id/promote
 *
 * Drives promoteBatch() from the UI. Uploader / actor is currently hardcoded
 * to the seeded data_owner — real auth lands in a later phase.
 *
 * Returns:
 *   200 — PromotionOutput JSON on success.
 *   400 — { error, message } for promotion-service errors (batch not found,
 *         wrong status, etc.). The service throws plain `Error` for both, so
 *         a single mapping is fine for now.
 *   500 — anything genuinely unexpected (DB outage, etc.).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const dataOwner = await db.user.findFirst({
      where: { role: "data_owner" },
      select: { id: true },
    });
    if (!dataOwner) {
      return NextResponse.json(
        {
          error: "no_data_owner",
          message: "No data_owner user found. Run `npm run db:seed` first.",
        },
        { status: 500 },
      );
    }

    const output = await promoteBatch({
      batchId: id,
      actorUserId: dataOwner.id,
    });

    return NextResponse.json(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/intake/batches/${id}/promote]`, err);
    return NextResponse.json(
      { error: "promotion_failed", message },
      { status: 400 },
    );
  }
}
