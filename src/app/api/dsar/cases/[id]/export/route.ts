import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exportSubjectData } from "@/services/dsar";

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
    const out = await exportSubjectData(id, dataOwner.id);
    return new NextResponse(JSON.stringify(out.exportJson, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "export_subject_data_failed", message },
      { status: 500 },
    );
  }
}
