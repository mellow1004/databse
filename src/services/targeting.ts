import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { filterTargetableContacts } from "@/services/suppression";

export type TargetingFilters = {
  clientId: string;
  gates?: Array<"gate_1" | "gate_2" | "gate_3">;
  countries?: string[];
  excludeIndustries?: string[];
  minFreshnessDays?: number;
  excludeCampaignActive?: boolean;
  limit?: number;
};

export type TargetingResult = {
  totalEligible: number;
  returned: number;
  contacts: Array<{
    contactId: string;
    fullName: string;
    email: string | null;
    title: string | null;
    companyName: string;
    country: string | null;
    gateStatus: string;
    lastVerifiedAt: Date | null;
    campaignActive: boolean;
  }>;
};

function buildWhere(filters: TargetingFilters): Prisma.ContactWhereInput {
  const gates = filters.gates?.length ? filters.gates : (["gate_2"] as const);

  const companyClauses: Prisma.CompanyWhereInput[] = [];
  if (filters.countries?.length) {
    companyClauses.push({ country: { in: filters.countries } });
  }
  if (filters.excludeIndustries?.length) {
    const ex = filters.excludeIndustries;
    companyClauses.push({
      OR: [{ industry: null }, { NOT: { industry: { in: ex } } }],
    });
  }

  const companyWhere: Prisma.CompanyWhereInput | undefined =
    companyClauses.length > 0 ? { AND: companyClauses } : undefined;

  const freshnessCutoff =
    filters.minFreshnessDays !== undefined
      ? new Date(Date.now() - filters.minFreshnessDays * 24 * 60 * 60 * 1000)
      : undefined;

  const where: Prisma.ContactWhereInput = {
    clientId: filters.clientId,
    mergedIntoId: null,
    quarantineReason: null,
    lifecycleStage: "active",
    gateStatus: { in: gates as string[] },
    ...(filters.excludeCampaignActive !== false
      ? { campaignActive: false }
      : {}),
    ...(freshnessCutoff
      ? { lastVerifiedAt: { gte: freshnessCutoff } }
      : {}),
    ...(companyWhere ? { company: companyWhere } : {}),
  };

  return where;
}

export async function buildTargetingList(
  filters: TargetingFilters,
): Promise<TargetingResult> {
  const limit = filters.limit ?? 100;
  const where = buildWhere(filters);

  const rows = await db.contact.findMany({
    where,
    include: {
      person: { select: { fullName: true, primaryEmail: true } },
      company: { select: { legalName: true, country: true } },
    },
    orderBy: { lastVerifiedAt: "desc" },
  });

  const ids = rows.map((r) => r.id);
  const targetableIds = new Set(await filterTargetableContacts(ids, filters.clientId));

  const eligibleOrdered = rows.filter((r) => targetableIds.has(r.id));
  const totalEligible = eligibleOrdered.length;
  const picked = eligibleOrdered.slice(0, limit);

  const contacts = picked.map((r) => ({
    contactId: r.id,
    fullName: r.person.fullName,
    email: r.email ?? r.person.primaryEmail ?? null,
    title: r.title ?? null,
    companyName: r.company.legalName,
    country: r.company.country ?? null,
    gateStatus: r.gateStatus,
    lastVerifiedAt: r.lastVerifiedAt,
    campaignActive: r.campaignActive,
  }));

  return {
    totalEligible,
    returned: contacts.length,
    contacts,
  };
}
