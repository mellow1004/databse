import { NextResponse } from "next/server";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { runRefreshCycle } from "@/services/refreshCycle";

export const maxDuration = 90;

type RunBody = {
  clientId?: string;
  maxContacts?: number;
  performAnonymisation?: boolean;
};

export async function POST(req: Request) {
  try {
    const actorUserId = await requireDataOwnerActorId();
    const body = (await req.json()) as RunBody;

    const clientId =
      body.clientId === undefined || body.clientId === "" || body.clientId === "__all__"
        ? null
        : body.clientId;

    const result = await runRefreshCycle({
      clientId,
      maxContacts: body.maxContacts,
      performAnonymisation: body.performAnonymisation,
      actorUserId,
    });

    return NextResponse.json({
      ...result,
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt.toISOString(),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
