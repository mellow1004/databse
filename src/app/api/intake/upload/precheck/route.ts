import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseCsv, type HeaderMappingOverride } from "@/lib/csv-parser";
import { hashEmail, hashLinkedinUrl } from "@/lib/hashing";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

type PrecheckCounts = {
  would_be_accepted: number;
  would_be_rejected_tombstone: number;
  would_be_rejected_duplicate_in_batch: number;
  would_be_rejected_validation: number;
  would_be_rejected_existing_master_duplicate: number;
};

function emptyCounts(): PrecheckCounts {
  return {
    would_be_accepted: 0,
    would_be_rejected_tombstone: 0,
    would_be_rejected_duplicate_in_batch: 0,
    would_be_rejected_validation: 0,
    would_be_rejected_existing_master_duplicate: 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const clientId = form.get("clientId");
    const mappingsRaw = form.get("mappings");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file_missing", message: "No file provided." }, { status: 400 });
    }
    if (typeof clientId !== "string" || clientId.length === 0) {
      return NextResponse.json({ error: "client_missing", message: "clientId is required." }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "file_empty", message: "File is empty." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", message: `File exceeds ${MAX_FILE_SIZE_BYTES.toLocaleString()} bytes.` },
        { status: 400 },
      );
    }

    const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) {
      return NextResponse.json({ error: "client_not_found", message: "Unknown clientId." }, { status: 400 });
    }

    let mappings: HeaderMappingOverride | undefined = undefined;
    if (typeof mappingsRaw === "string" && mappingsRaw.trim()) {
      try {
        mappings = JSON.parse(mappingsRaw) as HeaderMappingOverride;
      } catch {
        return NextResponse.json({ error: "mappings_invalid", message: "mappings must be valid JSON." }, { status: 400 });
      }
    }

    const csvText = await file.text();
    const parsed = parseCsv(csvText, mappings);
    if (parsed.fileLevelErrors.length > 0) {
      return NextResponse.json({ error: "file_invalid", details: parsed.fileLevelErrors }, { status: 400 });
    }

    const rowHashes = parsed.rows.map((row) => ({
      email: row.candidate.email,
      linkedinUrl: row.candidate.linkedinUrl,
      emailHash: hashEmail(row.candidate.email),
      linkedinHash: hashLinkedinUrl(row.candidate.linkedinUrl),
    }));

    const distinctTombstoneHashes = new Set<string>();
    const distinctEmails = new Set<string>();
    const distinctLinkedins = new Set<string>();
    for (const r of rowHashes) {
      if (r.emailHash) distinctTombstoneHashes.add(r.emailHash);
      if (r.linkedinHash) distinctTombstoneHashes.add(r.linkedinHash);
      if (r.email) distinctEmails.add(r.email);
      if (r.linkedinUrl) distinctLinkedins.add(r.linkedinUrl);
    }

    const existingMasterOr: Prisma.ContactWhereInput[] = [];
    if (distinctEmails.size) existingMasterOr.push({ email: { in: [...distinctEmails] } });
    if (distinctLinkedins.size) {
      existingMasterOr.push({ person: { linkedinUrl: { in: [...distinctLinkedins] } } });
    }

    const [tombstones, existingContacts] = await Promise.all([
      distinctTombstoneHashes.size
        ? db.tombstone.findMany({
            where: { hashValue: { in: [...distinctTombstoneHashes] } },
            select: { hashType: true, hashValue: true },
          })
        : [],
      existingMasterOr.length
        ? db.contact.findMany({
            where: {
              clientId,
              mergedIntoId: null,
              OR: existingMasterOr,
            },
            select: {
              email: true,
              person: { select: { linkedinUrl: true } },
            },
          })
        : [],
    ]);

    const tombstoneSet = new Set(tombstones.map((t) => `${t.hashType}:${t.hashValue}`));
    const existingEmails = new Set(existingContacts.map((c) => c.email).filter((v): v is string => Boolean(v)));
    const existingLinkedins = new Set(
      existingContacts.map((c) => c.person.linkedinUrl).filter((v): v is string => Boolean(v)),
    );

    const counts = emptyCounts();
    const seenEmails = new Set<string>();
    const seenLinkedins = new Set<string>();

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const hashes = rowHashes[i]!;

      if (row.validationErrors.length > 0) {
        counts.would_be_rejected_validation += 1;
        continue;
      }

      if (
        (hashes.emailHash && tombstoneSet.has(`email_sha256:${hashes.emailHash}`)) ||
        (hashes.linkedinHash && tombstoneSet.has(`linkedin_url_sha256:${hashes.linkedinHash}`))
      ) {
        counts.would_be_rejected_tombstone += 1;
        continue;
      }

      if (
        (hashes.email && seenEmails.has(hashes.email)) ||
        (hashes.linkedinUrl && seenLinkedins.has(hashes.linkedinUrl))
      ) {
        counts.would_be_rejected_duplicate_in_batch += 1;
        continue;
      }

      if (
        (hashes.email && existingEmails.has(hashes.email)) ||
        (hashes.linkedinUrl && existingLinkedins.has(hashes.linkedinUrl))
      ) {
        counts.would_be_rejected_existing_master_duplicate += 1;
        continue;
      }

      if (hashes.email) seenEmails.add(hashes.email);
      if (hashes.linkedinUrl) seenLinkedins.add(hashes.linkedinUrl);
      counts.would_be_accepted += 1;
    }

    return NextResponse.json({
      counts,
      totalRows: parsed.totalRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "precheck_failed", message }, { status: 500 });
  }
}
