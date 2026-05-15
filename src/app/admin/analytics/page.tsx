import { AlertTriangle, Award, Lock, Users } from "lucide-react";
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

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [
    totalContacts,
    gate2Ready,
    pendingQuarantine,
    pendingConflicts,
    gateDistribution,
    providerTrend,
    verificationByDay,
    suppressionByDay,
  ] = await Promise.all([
    db.contact.count({ where: { mergedIntoId: null } }),
    db.contact.count({
      where: { gateStatus: "gate_2", mergedIntoId: null },
    }),
    db.quarantineLog.count({ where: { reviewState: "pending" } }),
    db.enrichmentLog.count({ where: { status: "conflict_pending" } }),
    getGateDistribution(),
    getProviderTrendInsufficient(),
    getVerificationVolumeByDay(),
    getSuppressionCumulativeByDay(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-slate-600">
          Operational dashboards: record health, provider performance, verification trends,
          and suppression growth.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Total contacts
            </CardTitle>
            <Users className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{totalContacts}</p>
            <p className="text-xs text-slate-500">Active in master DB</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Gate 2 ready
            </CardTitle>
            <Award className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{gate2Ready}</p>
            <p className="text-xs text-slate-500">Campaign-ready trust floor</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Pending quarantine
            </CardTitle>
            <Lock className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{pendingQuarantine}</p>
            <p className="text-xs text-slate-500">Awaiting Data Owner review</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">
              Pending conflicts
            </CardTitle>
            <AlertTriangle className="size-4 text-slate-400" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{pendingConflicts}</p>
            <p className="text-xs text-slate-500">Enrichment conflicts flagged</p>
          </CardContent>
        </Card>
      </div>

      <AnalyticsCharts
        gateDistribution={gateDistribution}
        providerTrend={providerTrend}
        verificationByDay={verificationByDay}
        suppressionByDay={suppressionByDay}
      />
    </div>
  );
}
