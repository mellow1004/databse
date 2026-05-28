import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { executeDsarErasure } from "@/services/dsar";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    const out = await executeDsarErasure(id, dataOwner.id);
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const clientError =
      message.toLowerCase().includes("not found") ||
      message.toLowerCase().includes("erasure");
    return NextResponse.json(
      { error: "execute_erasure_failed", message },
      { status: clientError ? 400 : 500 },
    );
  }
}
