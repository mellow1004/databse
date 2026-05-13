import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hardDeleteContact, type HardDeleteInput } from "@/services/hardDelete";

const DELETION_REASONS = new Set([
  "dsar_article_17",
  "retention_lifecycle",
  "manual_owner_request",
  "regulatory_order",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  let body: { reason?: string; deletionReason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const reason = (body.reason ?? "").trim();
  const deletionReason = (body.deletionReason ?? "").trim();

  if (reason.length < 5) {
    return NextResponse.json(
      { error: "invalid_reason", message: "Reason must be at least 5 characters." },
      { status: 400 },
    );
  }
  if (!DELETION_REASONS.has(deletionReason)) {
    return NextResponse.json(
      {
        error: "invalid_deletion_reason",
        message: `deletionReason must be one of: ${[...DELETION_REASONS].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const dataOwner = await db.user.findFirst({
    where: { role: "data_owner" },
    select: { id: true },
  });
  if (!dataOwner) {
    return NextResponse.json(
      { error: "no_data_owner", message: "No data_owner user found." },
      { status: 500 },
    );
  }

  try {
    const out = await hardDeleteContact({
      contactId,
      reason,
      actorUserId: dataOwner.id,
      deletionReason: deletionReason as HardDeleteInput["deletionReason"],
    });
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    const clientError =
      lower.includes("not found") ||
      lower.includes("soft-archived") ||
      lower.includes("merged") ||
      lower.includes("at least 5") ||
      lower.includes("invalid deletionreason");
    return NextResponse.json(
      { error: "hard_delete_failed", message },
      { status: clientError ? 400 : 500 },
    );
  }
}
