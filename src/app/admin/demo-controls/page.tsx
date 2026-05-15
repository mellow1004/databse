import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { ResetButton } from "./ResetButton";
import { WalkthroughScript } from "./WalkthroughScript";

export const dynamic = "force-dynamic";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export default async function DemoControlsPage() {
  const [
    importBatchCount,
    suppressionCount,
    pendingQuarantineCount,
    mergeHistoryCount,
    refreshLogCount,
    promotedFromCsvCount,
    activeCampaignCount,
    latestClient,
  ] = await Promise.all([
    db.importBatch.count(),
    db.suppression.count({ where: { releaseStatus: "active" } }),
    db.quarantineLog.count({ where: { reviewState: "pending" } }),
    db.mergeHistory.count(),
    db.refreshLog.count(),
    db.contact.count({
      where: { writeSource: "intake", mergedIntoId: null },
    }),
    db.contact.count({
      where: { campaignActive: true, mergedIntoId: null },
    }),
    db.client.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const stateRows: { label: string; value: string | number }[] = [
    { label: "Import batches", value: importBatchCount },
    { label: "Promoted contacts (from CSV)", value: promotedFromCsvCount },
    { label: "Active campaign contacts", value: activeCampaignCount },
    { label: "Pending quarantine", value: pendingQuarantineCount },
    { label: "Pending merges executed", value: mergeHistoryCount },
    { label: "Refresh cycles run", value: refreshLogCount },
    { label: "Active suppressions", value: suppressionCount },
    {
      label: "Last seed timestamp",
      value: formatDateTime(latestClient?.createdAt ?? null),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Demo controls</h1>
        <p className="text-sm text-slate-600">
          Tools to prepare and re-run the live walkthrough.
        </p>
      </div>

      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <Info className="size-4 shrink-0 text-amber-800" aria-hidden />
        <AlertDescription className="text-amber-900/90">
          This page contains presenter-only controls. The reset action permanently wipes
          uploaded batches, campaigns, merges, suppressions added during the session, and
          refresh-cycle history — then re-seeds the database to its baseline state.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Current demo state</CardTitle>
            <CardDescription>
              Live counts from the database (updates after reset).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {stateRows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-slate-600">{row.label}</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{row.value}</dd>
                </div>
              ))}
            </dl>
            <ResetButton />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Live walkthrough script (~5 min)</CardTitle>
            <CardDescription>
              Step-by-step presenter notes for the Brightvision demo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalkthroughScript />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
