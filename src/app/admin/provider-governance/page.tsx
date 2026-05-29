import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import ProviderQualityThresholdBadges from "@/components/provider-quality/ProviderQualityThresholdBadges";
import { checkProviderQualityAlerts, computeAccuracyStats, getLatestProviderAccuracy } from "@/services/accuracy";
import DemoteProviderButton from "./DemoteProviderButton";

export const dynamic = "force-dynamic";

const PROVIDERS = [
  "cognism",
  "apollo",
  "millionverifier",
  "bouncer",
  "cognism_diamond",
  "clay",
  "lusha",
] as const;

const FALLBACK_CHAIN = {
  email: "MillionVerifier -> Bouncer",
  enrichment: "Cognism for EU/Nordics -> Apollo for NA",
};

function boolBadge(v: boolean) {
  return (
    <Badge className={v ? "border-transparent bg-emerald-100 text-emerald-800" : "border-transparent bg-rose-100 text-rose-800"}>
      {v ? "Yes" : "No"}
    </Badge>
  );
}

export default async function ProviderGovernancePage() {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const [contracts, budgets, qualityAlerts] = await Promise.all([
    db.integrationContract.findMany({
      where: { providerName: { in: [...PROVIDERS] } },
      orderBy: { updatedAt: "desc" },
    }),
    db.providerBudget.findMany({
      where: {
        provider: { in: [...PROVIDERS] },
        periodType: "daily",
        periodStart: { lte: now },
        periodEnd: { gt: now },
      },
      orderBy: { periodStart: "desc" },
    }),
    checkProviderQualityAlerts(),
  ]);

  const contractByProvider = new Map<string, (typeof contracts)[number]>();
  for (const row of contracts) {
    if (!contractByProvider.has(row.providerName)) {
      contractByProvider.set(row.providerName, row);
    }
  }
  const budgetByProvider = new Map<string, (typeof budgets)[number]>();
  for (const row of budgets) {
    if (!budgetByProvider.has(row.provider)) {
      budgetByProvider.set(row.provider, row);
    }
  }

  const outageRows = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const [enrichError, enrichTotal, verifyError, verifyTotal] = await Promise.all([
        db.enrichmentLog.count({
          where: { provider, createdAt: { gte: fiveMinAgo }, status: "error" },
        }),
        db.enrichmentLog.count({
          where: { provider, createdAt: { gte: fiveMinAgo } },
        }),
        db.verification.count({
          where: { provider, createdAt: { gte: fiveMinAgo }, status: "error" },
        }),
        db.verification.count({
          where: { provider, createdAt: { gte: fiveMinAgo } },
        }),
      ]);
      const total = enrichTotal + verifyTotal;
      const errors = enrichError + verifyError;
      const errorRatio = total > 0 ? errors / total : 0;
      return { provider, total, errors, errorRatio, outage: total > 0 && errorRatio > 0.5 };
    }),
  );
  const outageByProvider = new Map(outageRows.map((r) => [r.provider, r]));

  const latestQaByProvider = new Map(
    (
      await Promise.all(
        PROVIDERS.map(async (provider) => ({
          provider,
          latest: await getLatestProviderAccuracy(provider),
        })),
      )
    ).map((row) => [row.provider, row.latest]),
  );

  const trendByProvider = new Map<string, Array<{ cycle: number; accuracy: number | null }>>();
  for (const provider of PROVIDERS) {
    const cyclesRaw = await db.accuracySample.findMany({
      where: { provider },
      distinct: ["cycleNumber"],
      select: { cycleNumber: true },
      orderBy: { cycleNumber: "desc" },
      take: 5,
    });
    const points: Array<{ cycle: number; accuracy: number | null }> = [];
    for (const c of cyclesRaw) {
      const stats = await computeAccuracyStats(provider, c.cycleNumber);
      points.push({ cycle: c.cycleNumber, accuracy: stats.accuracyRate });
    }
    trendByProvider.set(provider, points.sort((a, b) => a.cycle - b.cycle));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Provider governance</h1>
        <p className="text-sm text-slate-600">Contract, transfer, budget, outage, and quality oversight.</p>
      </div>

      {qualityAlerts.map((alert) => (
        <Alert key={`${alert.provider}-${alert.cycleNumber}`}>
          <AlertTitle>
            {alert.provider}: {alert.alertLevel === "demotion" ? "Demotion threshold" : "Investigation threshold"}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              Cycle {alert.cycleNumber} accuracy {alert.accuracyRate.toFixed(1)}%
            </span>
            <Link href="/admin/accuracy" className="underline underline-offset-4">
              Investigate
            </Link>
            {alert.alertLevel === "demotion" ? (
              <DemoteProviderButton
                provider={alert.provider}
                cycleNumber={alert.cycleNumber}
                accuracyRate={alert.accuracyRate}
              />
            ) : null}
          </AlertDescription>
        </Alert>
      ))}

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Contract version</TableHead>
                <TableHead>DPA signed</TableHead>
                <TableHead>SCCs in place</TableHead>
                <TableHead>Transfer + TIA</TableHead>
                <TableHead>Primary markets</TableHead>
                <TableHead>Daily budget usage</TableHead>
                <TableHead>Outage status</TableHead>
                <TableHead>Latest QA accuracy</TableHead>
                <TableHead>QA trend (last 5)</TableHead>
                <TableHead>Fallback chain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PROVIDERS.map((provider) => {
                const contract = contractByProvider.get(provider);
                const budget = budgetByProvider.get(provider);
                const outage = outageByProvider.get(provider);
                const trend = trendByProvider.get(provider) ?? [];
                const latestQa = latestQaByProvider.get(provider);
                return (
                  <TableRow key={provider}>
                    <TableCell className="font-medium">{provider}</TableCell>
                    <TableCell>{contract?.contractVersion ?? "—"}</TableCell>
                    <TableCell>{boolBadge(contract?.dataProcessingAgreementSigned ?? false)}</TableCell>
                    <TableCell>{boolBadge(contract?.sccsInPlace ?? false)}</TableCell>
                    <TableCell className="text-xs">
                      <div>{contract?.transferMechanism ?? "—"}</div>
                      <div className="text-muted-foreground">{contract?.transferImpactAssessmentRef ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {contract?.primaryMarkets
                        ? (() => {
                            try {
                              const parsed = JSON.parse(contract.primaryMarkets) as string[];
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {parsed.map((m) => (
                                    <Badge key={m} variant="outline">{m}</Badge>
                                  ))}
                                </div>
                              );
                            } catch {
                              return "—";
                            }
                          })()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {budget
                        ? `${budget.creditsUsed} credits / €${budget.spentEur.toFixed(2)} of €${budget.budgetEur.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={outage?.outage ? "border-transparent bg-rose-100 text-rose-800" : "border-transparent bg-emerald-100 text-emerald-800"}>
                        {outage?.outage ? "Outage detected" : "Healthy"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-y-2 text-xs">
                      {latestQa?.accuracyRate != null && latestQa.reviewed >= 10 ? (
                        <>
                          <div className="font-semibold tabular-nums text-slate-900">
                            {latestQa.accuracyRate.toFixed(1)}%
                            <span className="ml-1 font-normal text-muted-foreground">
                              (cycle {latestQa.cycleNumber})
                            </span>
                          </div>
                          <ProviderQualityThresholdBadges
                            provider={provider}
                            cycleNumber={latestQa.cycleNumber}
                            accuracyRate={latestQa.accuracyRate}
                            reviewed={latestQa.reviewed}
                          />
                        </>
                      ) : (
                        <span className="text-muted-foreground">Insufficient sample</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {trend.length === 0
                        ? "—"
                        : trend
                            .map((p) => `C${p.cycle}:${p.accuracy == null ? "—" : `${p.accuracy.toFixed(0)}%`}`)
                            .join(" · ")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {provider === "millionverifier" || provider === "bouncer"
                        ? FALLBACK_CHAIN.email
                        : provider === "cognism" || provider === "apollo"
                          ? FALLBACK_CHAIN.enrichment
                          : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
