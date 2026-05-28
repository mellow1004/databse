import { NextResponse } from "next/server";
import { previewRefreshCycle } from "@/services/refreshCycle";

type PreviewBody = {
  clientId?: string;
  maxContacts?: number;
  maxActiveContacts?: number;
  maxDormantContacts?: number;
  maxFrozenContacts?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PreviewBody;
    const clientId =
      body.clientId === undefined || body.clientId === "" || body.clientId === "__all__"
        ? null
        : body.clientId;
    const preview = await previewRefreshCycle({
      clientId,
      maxContacts: body.maxContacts,
      maxActiveContacts: body.maxActiveContacts,
      maxDormantContacts: body.maxDormantContacts,
      maxFrozenContacts: body.maxFrozenContacts,
    });
    return NextResponse.json(preview);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
