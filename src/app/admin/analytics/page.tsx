import { AlertTriangle, Coins, CopyX, MailWarning, Phone, RefreshCcw } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import {
  getGateDistribution,
  getProviderTrendInsufficient,
  getSuppressionCumulativeByDay,
  getVerificationVolumeByDay,
} from "@/services/analyticsChartsData";
import { AnalyticsCharts } from "./AnalyticsCharts";
import { CallingActivityCharts } from "./CallingActivityCharts";
import { getCallingActivityMetrics } from "@/services/otto2Analytics";

export const dynamic = "force-dynamic";

const DATE_RANGES = ["7", "30", "90", "all"] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientId?: string;
    provider?: string;
    market?: string;
    range?: string;
  }>;
}) {
  const sp = await searchParams;
  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const providerOptions = ["all", "cognism", "apollo"] as const;
  const selectedClientId =
    sp.clientId && clients.some((c) => c.id === sp.clientId) ? sp.clientId : "all";
  const selectedProvider = providerOptions.includes((sp.provider as any) ?? "all")
    ? ((sp.provider as typeof providerOptions[number]) ?? "all")
    : "all";
  const selectedRange = DATE_RANGES.includes((sp.range as any) ?? "30")
    ? ((sp.range as (typeof DATE_RANGES)[number]) ?? "30")
    : "30";
  const marketOptions = (
    await db.contact.findMany({
      where: { market: { not: null } },
      distinct: ["market"],
      select: { market: true },
      orderBy: { market: "asc" },
    })
  )
    .map((r) => r.market)
    .filter((m): m is string => Boolean(m));
  const selectedMarket =
    sp.market && marketOptions.includes(sp.market) ? sp.market : "all";
  const dateFrom =
    selectedRange === "all"
      ? undefined
      : new Date(Date.now() - Number(selectedRange) * 86_400_000);
  const filters = {
    clientId: selectedClientId === "all" ? undefined : selectedClientId,
    provider: selectedProvider === "all" ? undefined : selectedProvider,
    market: selectedMarket === "all" ? undefined : selectedMarket,
    dateFrom,
  };
  const [
    gateDistribution,
    providerTrend,
    verificationByDay,
    suppressionByDay,
    verificationTotals,
    duplicateTotals,
    gate2Adherence,
    providerBudgetCost,
    callingMetrics,
  ] = await Promise.all([
    getGateDistribution(filters),
    getProviderTrendInsufficient(filters),
    getVerificationVolumeByDay(filters),
    getSuppressionCumulativeByDay(filters),
    db.verification.groupBy({
      by: ["status"],
      where: {
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.dateFrom ? { createdAt: { gte: filters.dateFrom } } : {}),
      },
      _count: { _all: true },
    }),
    db.stagingRecord.groupBy({
      by: ["rejectionReason"],
      where: {
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.dateFrom ? { createdAt: { gte: filters.dateFrom } } : {}),
      },
      _count: { _all: true },
    }),
    db.contact.findMany({
      where: {
        mergedIntoId: null,
        gateStatus: "gate_2",
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.market ? { market: filters.market } : {}),
      },
      select: { id: true, lastVerifiedAt: true },
    }),
    db.providerBudget.aggregate({
      where: {
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.dateFrom ? { periodStart: { gte: filters.dateFrom } } : {}),
      },
      _sum: { spentEur: true },
    }),
    getCallingActivityMetrics({ clientId: filters.clientId }),
  ]);
  const verificationTotal = verificationTotals.reduce((s, r) => s + r._count._all, 0);
  const invalidOrBounce = verificationTotals
    .filter((r) => ["invalid", "bounce"].includes(r.status.toLowerCase()))
    .reduce((s, r) => s + r._count._all, 0);
  const hardBounceRate = verificationTotal > 0 ? (invalidOrBounce / verificationTotal) * 100 : 0;
  const duplicateOrTombstoned = duplicateTotals
    .filter((r) => (r.rejectionReason ?? "").startsWith("duplicate") || (r.rejectionReason ?? "").startsWith("tombstoned"))
    .reduce((s, r) => s + r._count._all, 0);
  const stagingTotal = duplicateTotals.reduce((s, r) => s + r._count._all, 0);
  const duplicateRate = stagingTotal > 0 ? (duplicateOrTombstoned / stagingTotal) * 100 : 0;
  const refreshed90d = gate2Adherence.filter(
    (c) => c.lastVerifiedAt && c.lastVerifiedAt.getTime() >= Date.now() - 90 * 86_400_000,
  ).length;
  const refreshAdherence = gate2Adherence.length > 0 ? (refreshed90d / gate2Adherence.length) * 100 : 0;
  const contactsTouched = verificationTotal;
  const providerCostPerRecord =
    contactsTouched > 0 ? (providerBudgetCost._sum.spentEur ?? 0) / contactsTouched : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-600">
          Operational dashboards: record health, provider performance, verification trends,
          and suppression growth.
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-6 mb-4 border-b bg-slate-50 px-6 py-3">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select name="clientId" defaultValue={selectedClientId} className="h-8 rounded-md border px-2 text-sm">
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="provider" defaultValue={selectedProvider} className="h-8 rounded-md border px-2 text-sm">
            <option value="all">All providers</option>
            <option value="cognism">Cognism</option>
            <option value="apollo">Apollo</option>
          </select>
          <select name="market" defaultValue={selectedMarket} className="h-8 rounded-md border px-2 text-sm">
            <option value="all">All markets</option>
            {marketOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select name="range" defaultValue={selectedRange} className="h-8 flex-1 rounded-md border px-2 text-sm">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All</option>
            </select>
            <button type="submit" className="h-8 rounded border px-3 text-sm">
              Apply
            </button>
          </div>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Hard bounce rate</CardTitle>
            <MailWarning className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{hardBounceRate.toFixed(1)}%</p>
            <p className="text-xs text-slate-500">invalid/bounce of verification events</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Duplicate rate</CardTitle>
            <CopyX className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{duplicateRate.toFixed(1)}%</p>
            <p className="text-xs text-slate-500">duplicate/tombstoned staging rejections</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Refresh adherence</CardTitle>
            <RefreshCcw className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">{refreshAdherence.toFixed(1)}%</p>
            <p className="text-xs text-slate-500">gate_2 verified within 90 days</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
            <CardTitle className="text-xs font-medium text-slate-600">Provider cost-per-record</CardTitle>
            <Coins className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-semibold tabular-nums">€{providerCostPerRecord.toFixed(2)}</p>
            <p className="text-xs text-slate-500">spent EUR / contacts touched</p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Calling activity (last 30 days)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-1">
              <CardTitle className="text-xs font-medium text-slate-600">Total calls</CardTitle>
              <Phone className="size-4 text-slate-400" aria-hidden />
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold tabular-nums">{callingMetrics.totalCalls}</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-slate-600">Answer rate</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold tabular-nums">
                {callingMetrics.answerRate.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500">not no_answer</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-slate-600">Qualified interview rate</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold tabular-nums">
                {callingMetrics.qualifiedInterviewRate.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-slate-600">Callback rate</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold tabular-nums">
                {callingMetrics.callbackRate.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-slate-600">Wrong number rate</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-semibold tabular-nums">
                {callingMetrics.wrongNumberRate.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <CallingActivityCharts byWeek={callingMetrics.byWeek} />
        </div>
      </section>

      <AnalyticsCharts
        gateDistribution={gateDistribution}
        providerTrend={providerTrend}
        verificationByDay={verificationByDay}
        suppressionByDay={suppressionByDay}
      />
    </div>
  );
}
