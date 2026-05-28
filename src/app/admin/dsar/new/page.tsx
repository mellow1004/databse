import { db } from "@/lib/db";
import NewDsarForm from "./NewDsarForm";

export default async function NewDsarCasePage() {
  const [clients, owners] = await Promise.all([
    db.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { role: "data_owner" },
      select: { id: true, fullName: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New DSAR case</h1>
      </div>
      <NewDsarForm clients={clients} owners={owners} />
    </div>
  );
}
