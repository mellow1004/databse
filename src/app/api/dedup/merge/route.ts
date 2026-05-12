import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { executeMerge, type MergeInput } from "@/services/merge";

/**
 * POST /api/dedup/merge
 *
 * Body: MergeInput minus `actorUserId` (resolved server-side to the seeded
 * data_owner — real auth lands in a later phase).
 *
 * Returns:
 *   200 — MergeOutput on success.
 *   400 — validation or service-error message (already archived, missing
 *         records, clientId mismatch, etc.).
 *   500 — unexpected failures only.
 */
export async function POST(req: NextRequest) {
  let body: Partial<Omit<MergeInput, "actorUserId">>;
  try {
    body = (await req.json()) as Partial<Omit<MergeInput, "actorUserId">>;
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "request body must be JSON" },
      { status: 400 },
    );
  }

  const { type, clientId, survivorId, mergedFromId, reason } = body;
  if (
    (type !== "contact" && type !== "company") ||
    !clientId ||
    !survivorId ||
    !mergedFromId ||
    !reason ||
    typeof reason !== "string" ||
    reason.trim() === ""
  ) {
    return NextResponse.json(
      {
        error: "bad_request",
        message:
          "Required fields: type ('contact'|'company'), clientId, survivorId, mergedFromId, reason.",
      },
      { status: 400 },
    );
  }

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

    const output = await executeMerge({
      type,
      clientId,
      survivorId,
      mergedFromId,
      fieldOverrides: body.fieldOverrides ?? {},
      reason: reason.trim(),
      actorUserId: dataOwner.id,
    });

    return NextResponse.json(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/dedup/merge]", err);
    return NextResponse.json(
      { error: "merge_failed", message },
      { status: 400 },
    );
  }
}
