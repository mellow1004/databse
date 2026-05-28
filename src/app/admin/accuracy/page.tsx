import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import {
  computeAccuracyStats,
  computeAccuracyTrend,
  maxAccuracyCycle,
} from "@/services/accuracy";
import {
  getAccuracyAlertVariant,
  getAccuracyRateTextClass,
} from "@/lib/badge-helpers";
import AccuracyNavBar from "./AccuracyNavBar";
import DrawSampleButton from "./DrawSampleButton";
import SampleReviewButtons from "./SampleReviewButtons";

export const dynamic = "force-dynamic";

const PROVIDERS = ["cognism", "apollo"] as const;

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function alertLabel(level: "ok" | "investigation" | "demotion" | "insufficient_data"): string {
  if (level === "insufficient_data") return "Insufficient data";
  if (level === "ok") return "OK";
  if (level === "investigation") return "Investigation";
  return "Demotion";
}

export default async function AccuracyQAPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; provider?: string }>;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (clients.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accuracy QA</h1>
          <p className="text-sm text-slate-600">No clients — run seed first.</p>
        </div>
      </div>
    );
  }

  const defaultClient =
    clients.find((c) => c.name === "Brightvision Internal") ?? clients[0]!;
  const requestedClientId = sp.clientId ?? "";
  const selectedClientId =
    requestedClientId && clients.some((c) => c.id === requestedClientId)
      ? requestedClientId
      : defaultClient.id;

  const p = (sp.provider ?? "cognism").toLowerCase();
  const selectedProvider: "cognism" | "apollo" =
    p === "apollo" ? "apollo" : "cognism";

  const currentClient = clients.find((c) => c.id === selectedClientId)!;

  const maxByProvider = await Promise.all(
    PROVIDERS.map(async (prov) => ({
      prov,
      max: await maxAccuracyCycle(selectedClientId, prov),
    })),
  );

  const latestStatsByProvider = await Promise.all(
    maxByProvider.map(async ({ prov, max }) => {
      if (max === null) {
        return {
          provider: prov,
          stats: null as Awaited<ReturnType<typeof computeAccuracyStats>> | null,
          nextCycle: 1,
        };
      }
      const stats = await computeAccuracyStats(prov, max, selectedClientId);
      return { provider: prov, stats, nextCycle: max + 1 };
    }),
  );

  const pendingSamples = await db.accuracySample.findMany({
    where: {
      clientId: selectedClientId,
      provider: selectedProvider,
      reviewedAt: null,
    },
    orderBy: { sampledAt: "desc" },
    take: 500,
  });

  const pendContactIds = Array.from(
    new Set(pendingSamples.map((s) => s.contactId)),
  );
  const pendContacts = pendContactIds.length
    ? await db.contact.findMany({
        where: { id: { in: pendContactIds } },
        include: {
          person: { select: { fullName: true, primaryEmail: true } },
          company: { select: { legalName: true } },
        },
      })
    : [];
  const pendById = new Map(pendContacts.map((c) => [c.id, c]));

  const trend = await computeAccuracyTrend(selectedProvider, selectedClientId, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accuracy QA</h1>
        <p className="text-sm text-slate-600">
          Per-provider sampling to catch systemic drift. 1% of gate_2, with 50 floor / 200
          cap.
        </p>
      </div>

      <AccuracyNavBar
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        selectedClientId={selectedClientId}
        selectedProvider={selectedProvider}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {latestStatsByProvider.map(({ provider, stats, nextCycle }) => {
          const rate = stats?.accuracyRate ?? null;
          const level = stats?.alertLevel ?? "insufficient_data";
          return (
            <Card key={provider} className="shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-lg capitalize">{provider}</CardTitle>
                <Badge className={getAccuracyAlertVariant(level)}>
                  {alertLabel(level)}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={cn(
                    "text-4xl font-semibold tabular-nums",
                    getAccuracyRateTextClass(rate),
                  )}
                >
                  {rate === null
                    ? "Insufficient sample"
                    : `${rate.toFixed(1)}%`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats ? (
                    <>
                      Latest cycle #{stats.cycleNumber} · {stats.totalSampled} sampled ·{" "}
                      {stats.reviewed} reviewed
                      {stats.accuracyRate === null ? " · Insufficient sample — need ≥ 10 reviewed records to compute accuracy" : ""}
                    </>
                  ) : (
                    "No samples drawn yet for this provider."
                  )}
                </p>
                <Separator />
                <DrawSampleButton
                  clientId={selectedClientId}
                  provider={provider}
                  nextCycle={nextCycle}
                />
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Pending review — <span className="capitalize">{selectedProvider}</span>
        </h2>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Expected title</TableHead>
                  <TableHead>Sampled at</TableHead>
                  <TableHead className="w-56">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingSamples.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-600">
                      No samples pending review for {selectedProvider}. Draw a new sample to
                      start a QA cycle.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingSamples.map((s) => {
                    const c = pendById.get(s.contactId);
                    const email = c?.person.primaryEmail ?? c?.email ?? null;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          {c ? (
                            <>
                              <Link
                                href={`/admin/contacts/${c.id}`}
                                className="font-medium text-primary underline-offset-4 hover:underline"
                              >
                                {c.person.fullName}
                              </Link>
                              <div className="break-all text-xs text-muted-foreground">
                                {email ?? (
                                  <span className="italic text-muted-foreground/80">
                                    (no email)
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <span className="font-mono text-xs">
                              {s.contactId.slice(0, 10)}…
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {c?.company?.legalName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{s.expectedValue}</TableCell>
                        <TableCell className="tabular-nums text-xs text-muted-foreground">
                          {relativeTime(s.sampledAt)}
                        </TableCell>
                        <TableCell>
                          <SampleReviewButtons sampleId={s.id} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Accuracy trend — <span className="capitalize">{selectedProvider}</span>
        </h2>
        <Card className="max-w-3xl shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Sampled</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead>Correct</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trend.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-600">
                      No completed cycles yet for this provider in {currentClient.name}.
                    </TableCell>
                  </TableRow>
                ) : (
                  trend.map((row) => (
                    <TableRow key={row.cycleNumber}>
                      <TableCell className="tabular-nums">{row.cycleNumber}</TableCell>
                      <TableCell className="tabular-nums">{row.totalSampled}</TableCell>
                      <TableCell className="tabular-nums">{row.reviewed}</TableCell>
                      <TableCell className="tabular-nums">{row.correct}</TableCell>
                      <TableCell
                        className={cn(
                          "font-medium tabular-nums",
                          getAccuracyRateTextClass(row.accuracyRate),
                        )}
                      >
                        {row.accuracyRate === null ? "Insufficient sample" : `${row.accuracyRate.toFixed(1)}%`}
                      </TableCell>
                      <TableCell>
                        <Badge className={getAccuracyAlertVariant(row.alertLevel)}>
                          {alertLabel(row.alertLevel)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
