import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBiasMonitoringReport } from "@/services/biasMonitoring";
import { BiasCategoryCard } from "./BiasCategoryCard";

export const dynamic = "force-dynamic";

export default async function BiasMonitoringPage() {
  const report = await computeBiasMonitoringReport();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bias monitoring</h1>
        <p className="text-sm text-slate-600">
          Statistical skew analysis across protected and proxy categories. Required by AI
          Act Article 10 (data governance) and GDPR fairness principle.
        </p>
      </div>

      <Alert>
        <Info className="size-4 shrink-0" aria-hidden />
        <AlertDescription>
          This page compares gate-promotion rates across protected categories. Subgroups
          deviating by more than {report.tolerancePp} percentage points from the overall rate
          are flagged for quality investigation. In production, a quarterly review by the
          Data Owner is recorded as a separate processing activity. Subgroups with fewer
          than 20 contacts are excluded to avoid noise.
        </AlertDescription>
      </Alert>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Overall baseline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-semibold tabular-nums text-slate-900">
            {report.overallRate}%
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {report.overallGate2Count} of {report.totalActive} active contacts (
            {report.totalSkippedSmallSample} excluded due to small sample size). Baseline is
            gate_2 rate across all active contacts including gate_0.
          </p>
        </CardContent>
      </Card>

      <BiasCategoryCard section={report.country} overallRate={report.overallRate} />
      <BiasCategoryCard section={report.headcount} overallRate={report.overallRate} />
      <BiasCategoryCard section={report.gender} overallRate={report.overallRate} />
    </div>
  );
}
