import { db } from "@/lib/db";

/** Demo: resolve the platform Data Owner as the actor for AI SDR writebacks. */
export async function requireDataOwnerActorId(): Promise<string> {
  const u = await db.user.findFirst({
    where: { role: "data_owner", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!u) {
    throw new Error("No active data_owner user in database");
  }
  return u.id;
}
