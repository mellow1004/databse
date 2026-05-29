import { NextResponse } from "next/server";
import { getSuppressionReleaseScopeSummary } from "@/services/suppression";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const summary = await getSuppressionReleaseScopeSummary(id);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.toLowerCase().includes("not found");
    return NextResponse.json(
      { error: "scope_summary_failed", message },
      { status: notFound ? 404 : 500 },
    );
  }
}
