import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enrichContactsBulk } from "@/services/enrichment";
import { evaluateAndApplyBulk } from "@/services/gates";
import { verifyContactsBulk } from "@/services/verification";
import type { PipelineSummary } from "@/app/admin/intake/batches/[id]/ProcessSection";

/**
 * POST /api/intake/batches/:id/process
 *
 * Runs the full Phase-4 data-plane pipeline against a single batch's
 * promoted contacts, sequentially:
 *
 *   1. verifyContactsBulk       — MillionVerifier with Bouncer waterfall
 *   2. enrichContactsBulk       — Cognism + Apollo, primary-by-market
 *   3. evaluateAndApplyBulk     — gate_1 ↔ gate_2 trust-floor evaluation
 *
 * Each underlying service writes its own audit_log row; this route adds one
 * more — `pipeline_completed` — keyed on the batch id so the detail page
 * server component can render the green completed card after a refresh.
 *
 * Returns:
 *   200 — the PipelineSummary JSON used by the client component.
 *   400 — { error, message } when the batch hasn't been promoted yet or has
 *         no promoted contacts to operate on.
 *   500 — anything genuinely unexpected.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const batch = await db.importBatch.findUnique({ where: { id } });
    if (!batch) {
      return NextResponse.json(
        { error: "batch_not_found", message: `Batch ${id} not found.` },
        { status: 400 },
      );
    }
    if (batch.status !== "completed") {
      return NextResponse.json(
        {
          error: "batch_not_promoted",
          message: `Batch must be in 'completed' status to run the pipeline (current: ${batch.status}). Promote it first.`,
        },
        { status: 400 },
      );
    }
    if (batch.rowsPromoted === 0) {
      return NextResponse.json(
        {
          error: "no_promoted_rows",
          message: "Batch has no promoted contacts to run the pipeline against.",
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
        {
          error: "no_data_owner",
          message: "No data_owner user found. Run `npm run db:seed` first.",
        },
        { status: 500 },
      );
    }

    // Collect promoted contact ids from staging_records — every accepted +
    // promoted row carries a pointer to the master Contact it became.
    const promotedRows = await db.stagingRecord.findMany({
      where: {
        batchId: id,
        status: "promoted",
        promotedContactId: { not: null },
      },
      select: { promotedContactId: true },
    });
    const contactIds = promotedRows
      .map((r) => r.promotedContactId!)
      .filter((cid): cid is string => typeof cid === "string");

    if (contactIds.length === 0) {
      return NextResponse.json(
        {
          error: "no_promoted_contacts",
          message:
            "No staging_record rows with a promotedContactId — pipeline has nothing to run on.",
        },
        { status: 400 },
      );
    }

    const verificationResult = await verifyContactsBulk(contactIds, {
      actorUserId: dataOwner.id,
      emailWaterfall: true,
    });
    const enrichmentResult = await enrichContactsBulk(contactIds, {
      actorUserId: dataOwner.id,
    });
    const gateResult = await evaluateAndApplyBulk(contactIds, dataOwner.id);

    const summary: PipelineSummary = {
      contactCount: contactIds.length,
      verification: {
        total: verificationResult.total,
        succeeded: verificationResult.succeeded,
        failed: verificationResult.failed,
        creditsByProvider: verificationResult.creditsByProvider,
      },
      enrichment: {
        total: enrichmentResult.total,
        enriched: enrichmentResult.enriched,
        noMatch: enrichmentResult.noMatch,
        skipped: enrichmentResult.skipped,
        failed: enrichmentResult.failed,
        conflictsFlagged: enrichmentResult.conflictsFlagged,
        creditsByProvider: enrichmentResult.creditsByProvider,
      },
      gates: {
        total: gateResult.total,
        promoted: gateResult.promoted,
        downgraded: gateResult.downgraded,
        unchanged: gateResult.unchanged,
        quarantined: gateResult.quarantined,
      },
    };

    // The batch-detail server component re-reads this row on refresh to
    // decide which state the ProcessSection card should render in.
    await db.auditLog.create({
      data: {
        clientId: batch.clientId,
        actorUserId: dataOwner.id,
        action: "pipeline_completed",
        resourceType: "import_batch",
        resourceId: id,
        recordsAffected: contactIds.length,
        afterState: JSON.stringify(summary),
      },
    });

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[POST /api/intake/batches/${id}/process]`, err);
    return NextResponse.json(
      { error: "pipeline_failed", message },
      { status: 500 },
    );
  }
}
