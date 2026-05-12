import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashEmail, hashLinkedinUrl } from "@/lib/hashing";
import type { ParseResult } from "@/types/intake";

/**
 * Intake service (PRD Module 1).
 *
 * Writes a parsed CSV (from src/lib/csv-parser.ts) into the staging layer,
 * applies tombstone-driven rejection at write-time, and detects duplicates
 * within the same batch. Promotion from staging into contacts/companies is
 * handled in Phase 3, not here.
 *
 * Per-row rejection precedence:
 *   1. validationErrors.length > 0 → "validation_failed"
 *   2. hashEmail / hashLinkedinUrl matches a Tombstone row
 *        → "tombstoned_email" or "tombstoned_linkedin"
 *   3. candidate.email or candidate.linkedinUrl already seen earlier in
 *      this batch → "duplicate_in_batch"
 *   4. otherwise → "accepted"
 *
 * The full original CSV row is preserved verbatim in StagingRecord.rawValues
 * (as a JSON string) for provenance + dispute trail.
 */

export type ImportSource =
  | "crm_export"
  | "campaign_file"
  | "spreadsheet"
  | "vendor_export"
  | "manual";

export type IntakeInput = {
  clientId: string;
  fileName: string;
  fileSizeBytes: number;
  source: ImportSource;
  sourceDetail?: string;
  uploadedBy: string;
  parseResult: ParseResult;
};

export type RejectionReason =
  | "tombstoned_email"
  | "tombstoned_linkedin"
  | "tombstoned_phone"
  | "missing_required_fields"
  | "validation_failed"
  | "duplicate_in_batch";

export type IntakeOutput = {
  batchId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsRejected: number;
  rejectionBreakdown: Record<RejectionReason, number>;
};

function emptyBreakdown(): Record<RejectionReason, number> {
  return {
    tombstoned_email: 0,
    tombstoned_linkedin: 0,
    tombstoned_phone: 0,
    missing_required_fields: 0,
    validation_failed: 0,
    duplicate_in_batch: 0,
  };
}

export async function intake(input: IntakeInput): Promise<IntakeOutput> {
  // ---- Step A: Create ImportBatch (status = "parsing") ----
  const batch = await db.importBatch.create({
    data: {
      clientId: input.clientId,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      uploadedBy: input.uploadedBy,
      rowsTotal: input.parseResult.totalRows,
      status: "parsing",
    },
    select: { id: true },
  });
  const batchId = batch.id;

  // ---- Pre-compute per-row hashes once, then run a single tombstone lookup ----
  type RowMeta = {
    emailHash: string | null;
    linkedinHash: string | null;
  };
  const rowMetas: RowMeta[] = input.parseResult.rows.map((row) => ({
    emailHash: hashEmail(row.candidate.email),
    linkedinHash: hashLinkedinUrl(row.candidate.linkedinUrl),
  }));

  const distinctHashes = new Set<string>();
  for (const m of rowMetas) {
    if (m.emailHash) distinctHashes.add(m.emailHash);
    if (m.linkedinHash) distinctHashes.add(m.linkedinHash);
  }

  // Composite key (hashType:hashValue) → set of matched tombstone identities.
  // Using the composite key keeps "this hash is tombstoned as an email" distinct
  // from "this hash is tombstoned as a linkedinUrl" — the two paths reject under
  // different RejectionReason values.
  const matchedTombstones = new Set<string>();
  if (distinctHashes.size > 0) {
    const hits = await db.tombstone.findMany({
      where: { hashValue: { in: [...distinctHashes] } },
      select: { hashType: true, hashValue: true },
    });
    for (const hit of hits) {
      matchedTombstones.add(`${hit.hashType}:${hit.hashValue}`);
    }
  }

  // ---- Step B: process each row ----
  const seenEmails = new Map<string, number>();        // email → first row number
  const seenLinkedinUrls = new Map<string, number>();  // url   → first row number
  const breakdown = emptyBreakdown();
  const stagingRows: Prisma.StagingRecordCreateManyInput[] = [];

  for (let i = 0; i < input.parseResult.rows.length; i++) {
    const row = input.parseResult.rows[i];
    const { emailHash, linkedinHash } = rowMetas[i];
    const c = row.candidate;

    let status: "accepted" | "rejected" = "accepted";
    let rejectionReason: RejectionReason | null = null;
    let rejectionDetail: string | null = null;

    if (row.validationErrors.length > 0) {
      // 1. Validation failure
      status = "rejected";
      rejectionReason = "validation_failed";
      rejectionDetail = row.validationErrors.join("; ");
    } else if (emailHash && matchedTombstones.has(`email_sha256:${emailHash}`)) {
      // 2a. Tombstoned email
      status = "rejected";
      rejectionReason = "tombstoned_email";
      rejectionDetail = "email matches tombstoned identifier";
    } else if (linkedinHash && matchedTombstones.has(`linkedin_url_sha256:${linkedinHash}`)) {
      // 2b. Tombstoned LinkedIn URL
      status = "rejected";
      rejectionReason = "tombstoned_linkedin";
      rejectionDetail = "linkedinUrl matches tombstoned identifier";
    } else if (c.email && seenEmails.has(c.email)) {
      // 3a. Duplicate email earlier in this batch
      status = "rejected";
      rejectionReason = "duplicate_in_batch";
      rejectionDetail = `email already in batch at row ${seenEmails.get(c.email)}`;
    } else if (c.linkedinUrl && seenLinkedinUrls.has(c.linkedinUrl)) {
      // 3b. Duplicate LinkedIn URL earlier in this batch
      status = "rejected";
      rejectionReason = "duplicate_in_batch";
      rejectionDetail = `linkedinUrl already in batch at row ${seenLinkedinUrls.get(c.linkedinUrl)}`;
    } else {
      // 4. Accepted — record identifiers so later rows can detect duplicates
      if (c.email) seenEmails.set(c.email, row.rowNumber);
      if (c.linkedinUrl) seenLinkedinUrls.set(c.linkedinUrl, row.rowNumber);
    }

    if (rejectionReason) breakdown[rejectionReason] += 1;

    stagingRows.push({
      clientId: input.clientId,
      batchId,
      rowNumber: row.rowNumber,
      rawValues: JSON.stringify(row.rawValues),
      candidateEmail: c.email,
      candidateLinkedinUrl: c.linkedinUrl,
      candidatePhone: c.phone,
      candidateFullName: c.fullName,
      candidateCompanyName: c.companyName,
      candidateDomain: c.domain,
      candidateTitle: c.title,
      candidateCountry: c.country,
      status,
      rejectionReason,
      rejectionDetail,
    });
  }

  // Single bulk write for every parsed row regardless of outcome.
  if (stagingRows.length > 0) {
    await db.stagingRecord.createMany({ data: stagingRows });
  }

  const rowsAccepted = stagingRows.filter((r) => r.status === "accepted").length;
  const rowsRejected = stagingRows.length - rowsAccepted;

  // ---- Step C: finalise ImportBatch ----
  await db.importBatch.update({
    where: { id: batchId },
    data: {
      rowsAccepted,
      rowsRejected,
      rowsPromoted: 0,
      status: "ready_for_review",
      completedAt: new Date(),
    },
  });

  // ---- Step D: audit log entry ----
  await db.auditLog.create({
    data: {
      clientId: input.clientId,
      actorUserId: input.uploadedBy,
      action: "intake_completed",
      resourceType: "import_batch",
      resourceId: batchId,
      recordsAffected: input.parseResult.totalRows,
      afterState: JSON.stringify({
        rowsTotal: input.parseResult.totalRows,
        rowsAccepted,
        rowsRejected,
        rejectionBreakdown: breakdown,
      }),
    },
  });

  // ---- Step E: return summary ----
  return {
    batchId,
    rowsTotal: input.parseResult.totalRows,
    rowsAccepted,
    rowsRejected,
    rejectionBreakdown: breakdown,
  };
}
