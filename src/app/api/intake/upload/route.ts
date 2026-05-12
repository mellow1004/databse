import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseCsv } from "@/lib/csv-parser";
import { intake, type ImportSource } from "@/services/intake";

/**
 * POST /api/intake/upload
 *
 * Multipart form upload endpoint that parses the CSV, runs intake (tombstone
 * + in-batch duplicate checks, staging insert, audit entry), and returns the
 * IntakeOutput plus a redirect URL for the (Step 2.5) batch detail page.
 *
 * Auth is intentionally hardcoded for now — the uploader is resolved as the
 * seeded data_owner user. Real auth lands in a later phase.
 */

const VALID_SOURCES: ImportSource[] = [
  "crm_export",
  "campaign_file",
  "spreadsheet",
  "vendor_export",
  "manual",
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const clientId = form.get("clientId");
    const source = form.get("source");
    const sourceDetail = form.get("sourceDetail");

    // ---- Field-level validation ----
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file_missing", message: "No file provided." },
        { status: 400 },
      );
    }
    if (typeof clientId !== "string" || clientId.length === 0) {
      return NextResponse.json(
        { error: "client_missing", message: "clientId is required." },
        { status: 400 },
      );
    }
    if (typeof source !== "string" || !VALID_SOURCES.includes(source as ImportSource)) {
      return NextResponse.json(
        {
          error: "source_invalid",
          message: `source must be one of: ${VALID_SOURCES.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    // ---- File-shape validation ----
    const isCsvByName = file.name.toLowerCase().endsWith(".csv");
    const isCsvByType = (file.type || "").toLowerCase().includes("csv");
    if (!isCsvByName && !isCsvByType) {
      return NextResponse.json(
        { error: "file_not_csv", message: "File must be a CSV (.csv)." },
        { status: 400 },
      );
    }
    if (file.size <= 0) {
      return NextResponse.json(
        { error: "file_empty", message: "File is empty." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: "file_too_large",
          message: `File exceeds the ${MAX_FILE_SIZE_BYTES.toLocaleString()}-byte upload limit.`,
        },
        { status: 400 },
      );
    }

    // ---- Resolve actor + client ----
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

    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json(
        { error: "client_not_found", message: "Unknown clientId." },
        { status: 400 },
      );
    }

    // ---- Parse ----
    const csvText = await file.text();
    const parseResult = parseCsv(csvText);

    if (parseResult.fileLevelErrors.length > 0) {
      // File-level errors mean no batch is created — nothing usable to stage.
      return NextResponse.json(
        { error: "file_invalid", details: parseResult.fileLevelErrors },
        { status: 400 },
      );
    }

    // ---- Stage ----
    const detail =
      typeof sourceDetail === "string" && sourceDetail.trim().length > 0
        ? sourceDetail.trim()
        : undefined;

    const result = await intake({
      clientId,
      fileName: file.name,
      fileSizeBytes: file.size,
      source: source as ImportSource,
      sourceDetail: detail,
      uploadedBy: dataOwner.id,
      parseResult,
    });

    return NextResponse.json({
      ...result,
      redirectUrl: `/admin/intake/batches/${result.batchId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/intake/upload] unexpected failure:", err);
    return NextResponse.json(
      { error: "intake_failed", message },
      { status: 500 },
    );
  }
}
