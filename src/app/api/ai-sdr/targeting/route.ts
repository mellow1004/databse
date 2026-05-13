import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDataOwnerActorId } from "@/lib/data-owner-actor";
import { buildTargetingList, type TargetingFilters } from "@/services/targeting";

export async function POST(req: Request) {
  try {
    await requireDataOwnerActorId();
    const body = (await req.json()) as Partial<TargetingFilters>;
    if (!body.clientId || typeof body.clientId !== "string") {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }
    const client = await db.client.findUnique({
      where: { id: body.clientId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "client not found" }, { status: 400 });
    }

    const filters: TargetingFilters = {
      clientId: body.clientId,
      gates: body.gates,
      countries: body.countries,
      excludeIndustries: body.excludeIndustries,
      minFreshnessDays: body.minFreshnessDays,
      excludeCampaignActive: body.excludeCampaignActive,
      limit: body.limit,
    };

    const result = await buildTargetingList(filters);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal_error" },
      { status: 500 },
    );
  }
}
