import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { db } from "@/lib/db";
import { checkBulkApproval } from "@/services/bulkApproval";
import { normalizeEmail, normalizeDomain } from "@/lib/normalization";

type ParsedRow = {
  target_type: string;
  target_value: string;
  scope: string;
  reason_code: string;
  is_opt_out: string;
  notes: string;
};

function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const required = ["target_type", "target_value", "scope", "reason_code", "is_opt_out", "notes"];
  for (const r of required) {
    if (idx(r) === -1) throw new Error(`missing_column_${r}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
      target_type: cols[idx("target_type")] ?? "",
      target_value: cols[idx("target_value")] ?? "",
      scope: cols[idx("scope")] ?? "",
      reason_code: cols[idx("reason_code")] ?? "",
      is_opt_out: cols[idx("is_opt_out")] ?? "",
      notes: cols[idx("notes")] ?? "",
    };
  });
}

type Body = {
  clientId?: string;
  listType?: string;
  csvText?: string;
};

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as Body;
    if (!body.csvText || !body.listType) {
      return NextResponse.json({ error: "listType and csvText are required" }, { status: 400 });
    }
    const rows = parseCsv(body.csvText);
    if (rows.length === 0) {
      return NextResponse.json({ error: "no_rows" }, { status: 400 });
    }

    const approvalCheck = await checkBulkApproval({
      actionType: "bulk_suppression_import",
      recordsAffected: rows.length,
      requestorId: actorUserId,
      clientId: body.clientId,
      requestPayload: { listType: body.listType, rows: rows.length },
    });
    if (!approvalCheck.allowed) {
      return NextResponse.json({
        status: "request_pending",
        pendingApprovalId: approvalCheck.pendingApprovalId,
      });
    }

    const batch = await db.suppressionImportBatch.create({
      data: {
        clientId: body.clientId ?? null,
        listType: body.listType,
        fileName: `bulk-import-${new Date().toISOString().slice(0, 10)}.csv`,
        uploadedBy: actorUserId,
        rowsTotal: rows.length,
        status: "pending",
      },
    });

    let imported = 0;
    let rejected = 0;
    for (const row of rows) {
      try {
        const targetType = row.target_type.toLowerCase();
        const scope = row.scope || "client_level";
        const reasonCode = row.reason_code || "manual_flag";
        const isOptOut = row.is_opt_out.toLowerCase() === "true";
        const data = {
          scope,
          clientId: body.clientId ?? null,
          reasonCode,
          reasonDetail: row.notes || null,
          owner: actorUserId,
          source: body.listType,
          isOptOut,
          coolingPeriodIndefinite: isOptOut,
          releaseApprovalRequired: isOptOut,
          email:
            targetType === "email"
              ? normalizeEmail(row.target_value)
              : null,
          domain:
            targetType === "domain"
              ? normalizeDomain(row.target_value)
              : null,
          contactId: targetType === "contact_id" ? row.target_value : null,
        };
        await db.suppression.create({ data });
        imported += 1;
      } catch {
        rejected += 1;
      }
    }

    await db.suppressionImportBatch.update({
      where: { id: batch.id },
      data: {
        rowsImported: imported,
        rowsRejected: rejected,
        status: "completed",
        completedAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        clientId: body.clientId ?? null,
        actorUserId,
        action: "suppression_bulk_import_completed",
        resourceType: "suppression_import_batch",
        resourceId: batch.id,
        recordsAffected: imported,
        afterState: JSON.stringify({
          listType: body.listType,
          rowsTotal: rows.length,
          rowsImported: imported,
          rowsRejected: rejected,
        }),
      },
    });

    return NextResponse.json({
      status: "completed",
      batchId: batch.id,
      rowsTotal: rows.length,
      rowsImported: imported,
      rowsRejected: rejected,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
