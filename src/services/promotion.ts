import { db } from "@/lib/db";
import { captureSnapshot } from "@/services/snapshots";
import {
  resolveCompany,
  resolvePerson,
  resolveContact,
} from "@/services/identity";

/**
 * Promotion service (PRD Module 1 → master tables).
 *
 * Walks the accepted rows of an ImportBatch and lifts each one into the
 * Person / Company / Contact tables via the pure resolvers in identity.ts.
 * Newly-created contacts (and existing ones that are still at gate_0) are
 * transitioned to gate_1 with a matching GateStatusHistory entry, which is
 * the first promotion step PRD Module 4 prescribes.
 *
 * Idempotency: only batches in status="ready_for_review" can be promoted;
 * the function flips status to "promoting" up front and "completed" at the
 * end so a second call against the same batch throws.
 *
 * Failure model: per-row try/catch — a single bad row never aborts the
 * batch. Skipped rows are listed in the returned `errors` array.
 */

export type PromotionInput = {
  batchId: string;
  actorUserId: string;
};

export type PromotionOutput = {
  batchId: string;
  rowsAttempted: number;
  rowsPromoted: number;
  rowsSkipped: number;
  newPersons: number;
  newCompanies: number;
  newContacts: number;
  matchedExistingContacts: number;
  errors: { stagingRecordId: string; message: string }[];
};

const DERIVED_FIELD_VERSION = "v1";

export async function promoteBatch(input: PromotionInput): Promise<PromotionOutput> {
  // ---- Load + state guard ----
  const batch = await db.importBatch.findUnique({
    where: { id: input.batchId },
    select: {
      id: true,
      clientId: true,
      status: true,
      rowsPromoted: true,
    },
  });
  if (!batch) {
    throw new Error(`ImportBatch ${input.batchId} not found`);
  }
  if (batch.status !== "ready_for_review") {
    throw new Error(
      `ImportBatch ${input.batchId} is not promotable — current status: ${batch.status}`,
    );
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { status: "promoting" },
  });

  // ---- Walk accepted rows ----
  const acceptedRows = await db.stagingRecord.findMany({
    where: { batchId: batch.id, status: "accepted" },
    orderBy: { rowNumber: "asc" },
  });

  const output: PromotionOutput = {
    batchId: batch.id,
    rowsAttempted: acceptedRows.length,
    rowsPromoted: 0,
    rowsSkipped: 0,
    newPersons: 0,
    newCompanies: 0,
    newContacts: 0,
    matchedExistingContacts: 0,
    errors: [],
  };

  for (const row of acceptedRows) {
    try {
      // Domain is the load-bearing identifier for company resolution.
      // A staging row without one cannot be safely promoted; it sits in
      // staging until a Data Owner fixes the upstream source.
      if (!row.candidateDomain) {
        throw new Error("missing domain");
      }
      if (!row.candidateFullName) {
        // intake's parser composes fullName from first+last when missing, so
        // a null here means the staging row predates that derivation or was
        // inserted by hand. Either way we can't create a Person without one.
        throw new Error("missing fullName");
      }

      const { companyId, wasCreated: companyCreated } = await resolveCompany(
        batch.clientId,
        row.candidateDomain,
        row.candidateCompanyName,
        row.candidateCountry,
      );
      if (companyCreated) output.newCompanies += 1;

      const { personId, wasCreated: personCreated } = await resolvePerson(
        batch.clientId,
        row.candidateLinkedinUrl,
        row.candidateEmail,
        row.candidatePhone,
        row.candidateFullName,
        null, // staging doesn't store first/last separately
        null,
      );
      if (personCreated) output.newPersons += 1;

      const { contactId, wasCreated: contactCreated } = await resolveContact(
        batch.clientId,
        personId,
        companyId,
        {
          email: row.candidateEmail,
          phone: row.candidatePhone,
          title: row.candidateTitle,
        },
      );
      if (contactCreated) {
        output.newContacts += 1;
      } else {
        output.matchedExistingContacts += 1;
      }

      // Gate transition: promote any gate_0 contact (just-created OR sitting
      // at gate_0 from a previous run) up to gate_1. Anything at gate_1+ is
      // left alone — those promotions belong to later modules.
      const fromGate: string | null = contactCreated ? null : "gate_0";
      let shouldTransition = false;

      if (contactCreated) {
        // resolveContact just created this row at gate_0, so transition.
        shouldTransition = true;
      } else {
        // Existing contact — only transition if still at gate_0.
        const current = await db.contact.findUnique({
          where: { id: contactId },
          select: { gateStatus: true },
        });
        if (current?.gateStatus === "gate_0") {
          shouldTransition = true;
        }
      }

      if (shouldTransition) {
        const pre = await db.contact.findUnique({
          where: { id: contactId },
          select: { gateStatus: true, derivedFieldVersion: true },
        });
        if (pre) {
          await captureSnapshot({
            batchId: batch.id,
            batchType: "import_promotion",
            records: [
              {
                recordType: "contact",
                recordId: contactId,
                data: {
                  gateStatus: pre.gateStatus,
                  derivedFieldVersion: pre.derivedFieldVersion,
                },
              },
            ],
          });
        }
        await db.contact.update({
          where: { id: contactId },
          data: {
            gateStatus: "gate_1",
            derivedFieldVersion: DERIVED_FIELD_VERSION,
          },
        });
        await db.gateStatusHistory.create({
          data: {
            clientId: batch.clientId,
            contactId,
            fromGate,
            toGate: "gate_1",
            reason: "intake_promotion",
            actor: input.actorUserId,
            derivedFieldVersion: DERIVED_FIELD_VERSION,
          },
        });
      }

      // Mark the staging row as promoted with a pointer to its destination.
      await db.stagingRecord.update({
        where: { id: row.id },
        data: {
          status: "promoted",
          promotedContactId: contactId,
          promotedAt: new Date(),
        },
      });

      output.rowsPromoted += 1;
    } catch (err) {
      output.rowsSkipped += 1;
      output.errors.push({
        stagingRecordId: row.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Finalise batch ----
  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      rowsPromoted: { increment: output.rowsPromoted },
      status: "completed",
      completedAt: new Date(),
    },
  });

  // ---- Audit ----
  await db.auditLog.create({
    data: {
      clientId: batch.clientId,
      actorUserId: input.actorUserId,
      action: "batch_promoted",
      resourceType: "import_batch",
      resourceId: batch.id,
      recordsAffected: output.rowsPromoted,
      afterState: JSON.stringify(output),
    },
  });

  return output;
}
