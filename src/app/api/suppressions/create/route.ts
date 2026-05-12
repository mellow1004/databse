import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  normalizeDomain,
  normalizeEmail,
} from "@/lib/normalization";

/**
 * POST /api/suppressions/create
 *
 * Manual data-owner action — inserts a new suppression. The reasonCode
 * vocabulary mirrors the schema's documented set; we don't enforce it as a
 * runtime constraint so future reason codes can be added without breaking
 * historical UI.
 *
 * Validation:
 *   - scope must be one of the three known values
 *   - client_level requires clientId
 *   - at least one of (contactId | email | domain) must be present, with the
 *     one exception of "broad-client" suppressions (scope=client_level with
 *     all three identifiers null) — these are intentional client-wide blocks
 *   - opt-out cooling: when isOptOut=true and coolingPeriodIndefinite!==true,
 *     reviewRequiredBefore must be a valid future date
 *
 * 400 on validation errors, 500 on unexpected failures.
 */

const ALLOWED_SCOPES = new Set(["global", "client_level", "domain_level"]);
const ALLOWED_REASON_CODES = new Set([
  "competitor",
  "opt_out",
  "stop_reply",
  "legal_block",
  "conflict_of_interest",
  "bounce_repeated",
]);

type CreateBody = {
  scope?: string;
  clientId?: string | null;
  contactId?: string | null;
  email?: string | null;
  domain?: string | null;
  reasonCode?: string;
  reasonDetail?: string | null;
  isOptOut?: boolean;
  coolingPeriodIndefinite?: boolean;
  reviewRequiredBefore?: string | null;
};

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const scope = body.scope;
  if (!scope || !ALLOWED_SCOPES.has(scope)) {
    return NextResponse.json(
      {
        error: "invalid_scope",
        message: `scope must be one of: global, client_level, domain_level (got '${scope}').`,
      },
      { status: 400 },
    );
  }

  const reasonCode = body.reasonCode;
  if (!reasonCode || typeof reasonCode !== "string") {
    return NextResponse.json(
      { error: "missing_reason_code", message: "reasonCode is required." },
      { status: 400 },
    );
  }
  if (!ALLOWED_REASON_CODES.has(reasonCode)) {
    return NextResponse.json(
      {
        error: "invalid_reason_code",
        message: `reasonCode '${reasonCode}' is not one of the documented values.`,
      },
      { status: 400 },
    );
  }

  // Normalise identifiers — store the same canonical form the matcher reads.
  const contactId = body.contactId?.trim() || null;
  const email = normalizeEmail(body.email);
  const domain = normalizeDomain(body.domain);
  const hasAnyIdentifier =
    contactId !== null || email !== null || domain !== null;

  if (scope === "client_level") {
    if (!body.clientId) {
      return NextResponse.json(
        {
          error: "missing_client_id",
          message: "client_level scope requires clientId.",
        },
        { status: 400 },
      );
    }
  } else if (!hasAnyIdentifier) {
    // global / domain_level both require at least one identifier.
    return NextResponse.json(
      {
        error: "missing_identifier",
        message:
          "At least one of contactId, email, or domain must be provided for this scope.",
      },
      { status: 400 },
    );
  }

  const isOptOut = body.isOptOut === true;
  const coolingPeriodIndefinite =
    body.coolingPeriodIndefinite === undefined ? true : body.coolingPeriodIndefinite === true;
  let reviewRequiredBefore: Date | null = null;

  if (isOptOut && !coolingPeriodIndefinite) {
    if (!body.reviewRequiredBefore) {
      return NextResponse.json(
        {
          error: "missing_cooling_date",
          message:
            "Opt-out with non-indefinite cooling requires reviewRequiredBefore.",
        },
        { status: 400 },
      );
    }
    const parsed = new Date(body.reviewRequiredBefore);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        {
          error: "invalid_cooling_date",
          message: `reviewRequiredBefore '${body.reviewRequiredBefore}' is not a valid date.`,
        },
        { status: 400 },
      );
    }
    if (parsed.getTime() <= Date.now()) {
      return NextResponse.json(
        {
          error: "cooling_date_in_past",
          message: "reviewRequiredBefore must be a future date.",
        },
        { status: 400 },
      );
    }
    reviewRequiredBefore = parsed;
  }

  try {
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

    // If clientId was provided, verify it exists. Better to fail loudly than
    // silently insert an orphan.
    if (body.clientId) {
      const client = await db.client.findUnique({ where: { id: body.clientId } });
      if (!client) {
        return NextResponse.json(
          { error: "client_not_found", message: `Client ${body.clientId} not found.` },
          { status: 400 },
        );
      }
    }

    const row = await db.suppression.create({
      data: {
        scope,
        clientId: scope === "client_level" ? body.clientId! : null,
        contactId,
        email,
        domain,
        reasonCode,
        reasonDetail: body.reasonDetail?.trim() || null,
        owner: dataOwner.id,
        source: "manual",
        isOptOut,
        coolingPeriodIndefinite,
        reviewRequiredBefore,
      },
    });

    await db.auditLog.create({
      data: {
        clientId: row.clientId,
        actorUserId: dataOwner.id,
        action: "suppression_added",
        resourceType: "suppression",
        resourceId: row.id,
        afterState: JSON.stringify({
          scope: row.scope,
          reasonCode: row.reasonCode,
          contactId: row.contactId,
          email: row.email,
          domain: row.domain,
          isOptOut: row.isOptOut,
        }),
      },
    });

    return NextResponse.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/suppressions/create]", err);
    return NextResponse.json(
      { error: "create_failed", message },
      { status: 500 },
    );
  }
}
