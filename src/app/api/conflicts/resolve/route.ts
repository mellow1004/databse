import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/conflicts/resolve
 *
 * Body: { enrichmentLogId, chosenProvider: "cognism" | "apollo", reason }
 *
 * Resolves a `conflict_pending` row produced by the enrichment service. The
 * conflict row's own rawResponse carries both candidate values + provenance,
 * so this handler does not need to inspect sibling step-1/step-2 rows. The
 * actor is currently hard-coded to the seeded data_owner (auth lands later).
 *
 * Side effects, all wrapped in one $transaction:
 *   1. Updates the contact OR company with the chosen value (which table is
 *      determined by the field name).
 *   2. Flips the enrichment_log row's status to "conflict_resolved" and
 *      appends resolution metadata to its rawResponse.
 *   3. Inserts one audit_log row tagged action="conflict_resolved".
 */

const CONTACT_FIELDS = new Set(["title", "seniority", "phone"]);
const COMPANY_FIELDS = new Set(["industry", "country", "headcountBand"]);

type ConflictRaw = {
  field: string;
  primary: { provider: string; value: string | null; confidence: number };
  secondary: { provider: string; value: string | null; confidence: number };
  delta: number;
};

function parseConflict(raw: string): ConflictRaw | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ConflictRaw>;
    if (
      typeof parsed?.field === "string" &&
      parsed.primary &&
      typeof parsed.primary.provider === "string" &&
      parsed.secondary &&
      typeof parsed.secondary.provider === "string"
    ) {
      return parsed as ConflictRaw;
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { enrichmentLogId?: string; chosenProvider?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const enrichmentLogId = body.enrichmentLogId;
  const chosenProvider = body.chosenProvider;
  const reason = (body.reason ?? "").trim();
  if (!enrichmentLogId || typeof enrichmentLogId !== "string") {
    return NextResponse.json(
      { error: "missing_field", message: "enrichmentLogId is required." },
      { status: 400 },
    );
  }
  if (chosenProvider !== "cognism" && chosenProvider !== "apollo") {
    return NextResponse.json(
      {
        error: "invalid_provider",
        message: "chosenProvider must be 'cognism' or 'apollo'.",
      },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "missing_reason", message: "A non-empty reason is required." },
      { status: 400 },
    );
  }

  try {
    const conflictRow = await db.enrichmentLog.findUnique({
      where: { id: enrichmentLogId },
    });
    if (!conflictRow) {
      return NextResponse.json(
        { error: "not_found", message: `enrichment_log ${enrichmentLogId} not found.` },
        { status: 404 },
      );
    }
    if (conflictRow.status !== "conflict_pending") {
      return NextResponse.json(
        {
          error: "wrong_status",
          message: `enrichment_log row is in status '${conflictRow.status}', expected 'conflict_pending'.`,
        },
        { status: 400 },
      );
    }
    if (!conflictRow.rawResponse) {
      return NextResponse.json(
        { error: "missing_payload", message: "conflict row has no rawResponse to resolve from." },
        { status: 400 },
      );
    }
    const conflict = parseConflict(conflictRow.rawResponse);
    if (!conflict) {
      return NextResponse.json(
        { error: "invalid_payload", message: "conflict row rawResponse is malformed." },
        { status: 400 },
      );
    }

    // Map chosenProvider → primary or secondary side.
    const chosenSide =
      conflict.primary.provider === chosenProvider ? conflict.primary : conflict.secondary;
    const losingSide =
      conflict.primary.provider === chosenProvider ? conflict.secondary : conflict.primary;
    if (chosenSide.provider !== chosenProvider) {
      return NextResponse.json(
        {
          error: "provider_mismatch",
          message: `chosenProvider '${chosenProvider}' did not match either side of the conflict (primary=${conflict.primary.provider}, secondary=${conflict.secondary.provider}).`,
        },
        { status: 400 },
      );
    }

    const field = conflict.field;
    const chosenValue = chosenSide.value;
    const isContactField = CONTACT_FIELDS.has(field);
    const isCompanyField = COMPANY_FIELDS.has(field);
    if (!isContactField && !isCompanyField) {
      return NextResponse.json(
        {
          error: "unknown_field",
          message: `Field '${field}' is not a known enrichable field.`,
        },
        { status: 400 },
      );
    }

    if (!conflictRow.contactId) {
      return NextResponse.json(
        { error: "no_contact", message: "Conflict row has no contactId to update from." },
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

    let companyIdForUpdate: string | null = null;
    if (isCompanyField) {
      const c = await db.contact.findUnique({
        where: { id: conflictRow.contactId },
        select: { companyId: true },
      });
      if (!c) {
        return NextResponse.json(
          { error: "contact_missing", message: "Linked contact no longer exists." },
          { status: 404 },
        );
      }
      companyIdForUpdate = c.companyId;
    }

    const resolvedAt = new Date();
    const newRaw = {
      ...conflict,
      resolution: {
        resolvedBy: dataOwner.id,
        chosenProvider,
        chosenValue,
        reason,
        resolvedAt: resolvedAt.toISOString(),
      },
    };

    await db.$transaction(async (tx) => {
      if (isContactField) {
        await tx.contact.update({
          where: { id: conflictRow.contactId! },
          data: { [field]: chosenValue },
        });
      } else if (companyIdForUpdate) {
        await tx.company.update({
          where: { id: companyIdForUpdate },
          data: { [field]: chosenValue },
        });
      }

      await tx.enrichmentLog.update({
        where: { id: enrichmentLogId },
        data: {
          status: "conflict_resolved",
          rawResponse: JSON.stringify(newRaw),
        },
      });

      await tx.auditLog.create({
        data: {
          clientId: conflictRow.clientId,
          actorUserId: dataOwner.id,
          action: "conflict_resolved",
          resourceType: isContactField ? "contact" : "company",
          resourceId: isContactField ? conflictRow.contactId! : companyIdForUpdate!,
          beforeState: JSON.stringify({
            field,
            primary: conflict.primary,
            secondary: conflict.secondary,
          }),
          afterState: JSON.stringify({
            field,
            chosenProvider,
            chosenValue,
            losingProvider: losingSide.provider,
            losingValue: losingSide.value,
            reason,
          }),
        },
      });
    });

    return NextResponse.json({ resolved: true, field, chosenValue });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/conflicts/resolve]", err);
    return NextResponse.json(
      { error: "resolve_failed", message },
      { status: 500 },
    );
  }
}
