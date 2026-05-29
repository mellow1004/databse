import { db } from "@/lib/db";

export type ContactContention = {
  otherClientCount: number;
  otherClientNames: string[];
  otto2Active: boolean;
  hasContention: boolean;
};

function subDays(base: Date, days: number): Date {
  return new Date(base.getTime() - days * 86_400_000);
}

/** Batch contention signals for targeting list rows (other clients + Otto 2). */
export async function computeTargetingContention(
  clientId: string,
  contactIds: string[],
): Promise<Record<string, ContactContention>> {
  if (contactIds.length === 0) return {};

  const contacts = await db.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, personId: true },
  });
  const personIdByContact = new Map(contacts.map((c) => [c.id, c.personId]));
  const personIds = [...new Set(contacts.map((c) => c.personId))];

  const sevenDaysAgo = subDays(new Date(), 7);

  const [otherCampaignRows, pendingCallbacks, recentCalls] = await Promise.all([
    personIds.length
      ? db.contact.findMany({
          where: {
            personId: { in: personIds },
            clientId: { not: clientId },
            campaignActive: true,
            mergedIntoId: null,
          },
          select: {
            personId: true,
            client: { select: { name: true } },
          },
        })
      : [],
    db.otto2CallbackQueue.findMany({
      where: { contactId: { in: contactIds }, status: "pending" },
      select: { contactId: true },
    }),
    db.otto2Call.findMany({
      where: { contactId: { in: contactIds }, calledAt: { gte: sevenDaysAgo } },
      select: { contactId: true },
      distinct: ["contactId"],
    }),
  ]);

  const otherByPerson = new Map<string, string[]>();
  for (const row of otherCampaignRows) {
    const names = otherByPerson.get(row.personId) ?? [];
    if (!names.includes(row.client.name)) names.push(row.client.name);
    otherByPerson.set(row.personId, names);
  }

  const pendingSet = new Set(pendingCallbacks.map((r) => r.contactId));
  const recentCallSet = new Set(recentCalls.map((r) => r.contactId));

  const out: Record<string, ContactContention> = {};
  for (const id of contactIds) {
    const personId = personIdByContact.get(id);
    const otherClientNames = personId ? (otherByPerson.get(personId) ?? []) : [];
    const otto2Active = pendingSet.has(id) || recentCallSet.has(id);
    out[id] = {
      otherClientCount: otherClientNames.length,
      otherClientNames,
      otto2Active,
      hasContention: otherClientNames.length > 0 || otto2Active,
    };
  }
  return out;
}
