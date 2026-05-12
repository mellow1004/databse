/**
 * Merge execution service (Phase 3, Step 3.6).
 *
 * Given a survivor + mergedFrom pair and per-field "take from mergedFrom"
 * overrides, atomically:
 *   1. Validate both records (not soft-archived, same client, correct type).
 *   2. Apply field-level overrides onto the survivor row.
 *   3. Re-parent dependent rows (ContactCompanyRelationship for contact
 *      merges; Contact + DomainAlias + ContactCompanyRelationship for
 *      company merges).
 *   4. For company merges, register the mergedFrom rootDomain as a "legacy"
 *      alias of the survivor so future intake imports route to the survivor.
 *   5. Soft-archive the mergedFrom row (set mergedIntoId = survivorId).
 *      The row is preserved indefinitely — PRD Section 7 specifies a 30-day
 *      rollback window backed by merge_history.
 *   6. Insert merge_history + audit_log rows.
 *
 * Everything runs inside a single Prisma $transaction so a failed re-parent
 * cannot leave half-merged state.
 *
 * The two override sets below are exported so the review UI can decide
 * which fields render a toggle vs. an inert "—" cell (display-only fields
 * include derived values like contactCount or fields owned by a related
 * record such as Person.linkedinUrl).
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// ============================================================
// Public types
// ============================================================

export type MergeType = "contact" | "company";

export type MergeInput = {
  type: MergeType;
  clientId: string;
  survivorId: string;
  mergedFromId: string;
  /** For each field, true = take mergedFrom's value; false/missing = keep survivor's. */
  fieldOverrides: Record<string, boolean>;
  reason: string;
  actorUserId: string;
};

export type MergeOutput = {
  mergeHistoryId: string;
  survivorId: string;
  reassignedRelationships: number;
  reassignedContacts?: number;
  reassignedAliases?: number;
  newDomainAliasFromMerged?: string;
};

/** Fields the reviewer can pick from mergedFrom on a contact merge. */
export const CONTACT_OVERRIDEABLE_FIELDS: ReadonlySet<string> = new Set([
  "email",
  "phone",
  "title",
  "seniority",
]);

/** Fields the reviewer can pick from mergedFrom on a company merge. */
export const COMPANY_OVERRIDEABLE_FIELDS: ReadonlySet<string> = new Set([
  "legalName",
  "industry",
  "country",
  "headcountBand",
  "parentCompanyId",
]);

// ============================================================
// Helpers
// ============================================================

type FieldsResolvedEntry = {
  winningValue: unknown;
  losingValue: unknown;
  source: "survivor" | "merged_from";
};

function buildFieldDecisions(
  survivor: Record<string, unknown>,
  mergedFrom: Record<string, unknown>,
  overrideable: ReadonlySet<string>,
  fieldOverrides: Record<string, boolean>,
): {
  updateData: Record<string, unknown>;
  fieldsResolved: Record<string, FieldsResolvedEntry>;
} {
  const updateData: Record<string, unknown> = {};
  const fieldsResolved: Record<string, FieldsResolvedEntry> = {};

  for (const field of overrideable) {
    const survivorVal = survivor[field] ?? null;
    const mergedFromVal = mergedFrom[field] ?? null;
    const takeMergedFrom = fieldOverrides[field] === true;

    if (takeMergedFrom) {
      updateData[field] = mergedFromVal;
      fieldsResolved[field] = {
        winningValue: mergedFromVal,
        losingValue: survivorVal,
        source: "merged_from",
      };
    } else if (survivorVal !== mergedFromVal) {
      // Record the survivor-wins decision when the values actually differ —
      // identical values aren't a "decision" worth logging.
      fieldsResolved[field] = {
        winningValue: survivorVal,
        losingValue: mergedFromVal,
        source: "survivor",
      };
    }
  }

  return { updateData, fieldsResolved };
}

// ============================================================
// Public entrypoint
// ============================================================

export async function executeMerge(input: MergeInput): Promise<MergeOutput> {
  if (input.survivorId === input.mergedFromId) {
    throw new Error("survivorId and mergedFromId must differ");
  }
  if (!input.reason || input.reason.trim() === "") {
    throw new Error("merge reason is required");
  }
  if (input.type === "contact") return executeContactMerge(input);
  return executeCompanyMerge(input);
}

// ============================================================
// Contact merge
// ============================================================

async function executeContactMerge(input: MergeInput): Promise<MergeOutput> {
  const { clientId, survivorId, mergedFromId, fieldOverrides, reason, actorUserId } = input;

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const [survivor, mergedFrom] = await Promise.all([
      tx.contact.findUnique({ where: { id: survivorId } }),
      tx.contact.findUnique({ where: { id: mergedFromId } }),
    ]);
    if (!survivor) throw new Error(`survivor contact ${survivorId} not found`);
    if (!mergedFrom) throw new Error(`mergedFrom contact ${mergedFromId} not found`);
    if (survivor.clientId !== clientId || mergedFrom.clientId !== clientId) {
      throw new Error("clientId mismatch between survivor and mergedFrom");
    }
    if (survivor.mergedIntoId !== null) {
      throw new Error(`survivor ${survivorId} is already soft-archived`);
    }
    if (mergedFrom.mergedIntoId !== null) {
      throw new Error(`mergedFrom ${mergedFromId} is already soft-archived`);
    }

    const { updateData, fieldsResolved } = buildFieldDecisions(
      survivor as unknown as Record<string, unknown>,
      mergedFrom as unknown as Record<string, unknown>,
      CONTACT_OVERRIDEABLE_FIELDS,
      fieldOverrides,
    );

    if (Object.keys(updateData).length > 0) {
      await tx.contact.update({ where: { id: survivorId }, data: updateData });
    }

    const reassigned = await tx.contactCompanyRelationship.updateMany({
      where: { contactId: mergedFromId },
      data: { contactId: survivorId },
    });

    await tx.contact.update({
      where: { id: mergedFromId },
      data: { mergedIntoId: survivorId },
    });

    const mergeHistory = await tx.mergeHistory.create({
      data: {
        clientId,
        mergeType: "contact",
        survivorId,
        mergedFromId,
        fieldsResolved: JSON.stringify(fieldsResolved),
        reason,
        actor: actorUserId,
        batchId: null,
      },
      select: { id: true },
    });

    const output: MergeOutput = {
      mergeHistoryId: mergeHistory.id,
      survivorId,
      reassignedRelationships: reassigned.count,
    };

    await tx.auditLog.create({
      data: {
        clientId,
        actorUserId,
        action: "merge_executed",
        resourceType: "contact",
        resourceId: survivorId,
        recordsAffected: 2,
        afterState: JSON.stringify(output),
      },
    });

    return output;
  });
}

// ============================================================
// Company merge
// ============================================================

async function executeCompanyMerge(input: MergeInput): Promise<MergeOutput> {
  const { clientId, survivorId, mergedFromId, fieldOverrides, reason, actorUserId } = input;

  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const [survivor, mergedFrom] = await Promise.all([
      tx.company.findUnique({ where: { id: survivorId } }),
      tx.company.findUnique({ where: { id: mergedFromId } }),
    ]);
    if (!survivor) throw new Error(`survivor company ${survivorId} not found`);
    if (!mergedFrom) throw new Error(`mergedFrom company ${mergedFromId} not found`);
    if (survivor.clientId !== clientId || mergedFrom.clientId !== clientId) {
      throw new Error("clientId mismatch between survivor and mergedFrom");
    }
    if (survivor.mergedIntoId !== null) {
      throw new Error(`survivor ${survivorId} is already soft-archived`);
    }
    if (mergedFrom.mergedIntoId !== null) {
      throw new Error(`mergedFrom ${mergedFromId} is already soft-archived`);
    }

    const { updateData, fieldsResolved } = buildFieldDecisions(
      survivor as unknown as Record<string, unknown>,
      mergedFrom as unknown as Record<string, unknown>,
      COMPANY_OVERRIDEABLE_FIELDS,
      fieldOverrides,
    );

    if (Object.keys(updateData).length > 0) {
      await tx.company.update({ where: { id: survivorId }, data: updateData });
    }

    // Re-parent every row that referenced the mergedFrom company.
    const [reassignedContacts, reassignedAliases, reassignedRelationships] = await Promise.all([
      tx.contact.updateMany({
        where: { companyId: mergedFromId, mergedIntoId: null },
        data: { companyId: survivorId },
      }),
      tx.domainAlias.updateMany({
        where: { companyId: mergedFromId },
        data: { companyId: survivorId },
      }),
      tx.contactCompanyRelationship.updateMany({
        where: { companyId: mergedFromId },
        data: { companyId: survivorId },
      }),
    ]);

    // The mergedFrom company's rootDomain becomes a "legacy" alias of the
    // survivor so future intake imports of that domain route here. Skip
    // creating it if the domain is already an alias (anywhere in this client)
    // or is the survivor's own rootDomain — both would be unique-violations.
    let newDomainAliasFromMerged: string | undefined;
    const [existingAlias] = await Promise.all([
      tx.domainAlias.findUnique({
        where: { clientId_aliasDomain: { clientId, aliasDomain: mergedFrom.rootDomain } },
      }),
    ]);
    if (!existingAlias && survivor.rootDomain !== mergedFrom.rootDomain) {
      await tx.domainAlias.create({
        data: {
          clientId,
          companyId: survivorId,
          aliasDomain: mergedFrom.rootDomain,
          aliasType: "legacy",
        },
      });
      newDomainAliasFromMerged = mergedFrom.rootDomain;
    }

    await tx.company.update({
      where: { id: mergedFromId },
      data: { mergedIntoId: survivorId },
    });

    const mergeHistory = await tx.mergeHistory.create({
      data: {
        clientId,
        mergeType: "company",
        survivorId,
        mergedFromId,
        fieldsResolved: JSON.stringify(fieldsResolved),
        reason,
        actor: actorUserId,
        batchId: null,
      },
      select: { id: true },
    });

    const output: MergeOutput = {
      mergeHistoryId: mergeHistory.id,
      survivorId,
      reassignedRelationships: reassignedRelationships.count,
      reassignedContacts: reassignedContacts.count,
      reassignedAliases: reassignedAliases.count,
      newDomainAliasFromMerged,
    };

    await tx.auditLog.create({
      data: {
        clientId,
        actorUserId,
        action: "merge_executed",
        resourceType: "company",
        resourceId: survivorId,
        recordsAffected: 2,
        afterState: JSON.stringify(output),
      },
    });

    return output;
  });
}
