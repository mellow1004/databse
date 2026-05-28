import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDsarCase } from "@/services/dsar";

const CASE_TYPES = new Set([
  "access",
  "erasure",
  "rectification",
  "objection",
  "restriction",
  "portability",
]);

export async function POST(req: NextRequest) {
  let body: {
    clientId?: string;
    caseType?: string;
    subjectEmail?: string;
    subjectPhone?: string;
    subjectLinkedinUrl?: string;
    subjectName?: string;
    ownerId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!body.clientId || !body.ownerId || !body.caseType) {
    return NextResponse.json(
      {
        error: "missing_required_fields",
        message: "clientId, ownerId and caseType are required.",
      },
      { status: 400 },
    );
  }
  if (!CASE_TYPES.has(body.caseType)) {
    return NextResponse.json(
      { error: "invalid_case_type", message: "Invalid caseType." },
      { status: 400 },
    );
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

    const out = await createDsarCase({
      clientId: body.clientId,
      ownerId: body.ownerId,
      caseType: body.caseType as
        | "access"
        | "erasure"
        | "rectification"
        | "objection"
        | "restriction"
        | "portability",
      subjectEmail: body.subjectEmail,
      subjectPhone: body.subjectPhone,
      subjectLinkedinUrl: body.subjectLinkedinUrl,
      subjectName: body.subjectName,
      actorUserId: dataOwner.id,
    });
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "create_dsar_case_failed", message },
      { status: 500 },
    );
  }
}
