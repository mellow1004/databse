"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatGateStatus } from "@/lib/gate-labels";
import type {
  GateDistributionRow,
  ProviderTrendRow,
  SuppressionGrowthRow,
  VerificationDayRow,
} from "@/lib/analytics-chart-types";

const CHART_PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];

const GATE_HEX: Record<string, string> = {
  gate_0: "#94a3b8",
  gate_1: "#2563eb",
  gate_2: "#10b981",
  gate_3: "#8b5cf6",
};

const gateChartConfig = {
  gate_0: { label: "Staging", color: GATE_HEX.gate_0 },
  gate_1: { label: "Gate 1", color: GATE_HEX.gate_1 },
  gate_2: { label: "Gate 2", color: GATE_HEX.gate_2 },
  gate_3: { label: "Gate 3", color: GATE_HEX.gate_3 },
} satisfies ChartConfig;

const trendChartConfig = {
  cognism: { label: "Cognism", color: CHART_PALETTE[0] },
  apollo: { label: "Apollo", color: CHART_PALETTE[3] },
} satisfies ChartConfig;

const verificationChartConfig = {
  valid: { label: "Valid", color: "#10b981" },
  invalid: { label: "Invalid", color: "#ef4444" },
  risky: { label: "Risky", color: "#f59e0b" },
  unknown: { label: "Other", color: "#94a3b8" },
  catch_all: { label: "Catch-all", color: "#cbd5e1" },
  disposable: { label: "Disposable", color: "#cbd5e1" },
} satisfies ChartConfig;

const suppressionChartConfig = {
  total: { label: "Cumulative", color: "#475569" },
} satisfies ChartConfig;

type Props = {
  gateDistribution: GateDistributionRow[];
  providerTrend: { insufficient: boolean; rows: ProviderTrendRow[] };
  verificationByDay: VerificationDayRow[];
  suppressionByDay: SuppressionGrowthRow[];
};

export function AnalyticsCharts({
  gateDistribution,
  providerTrend,
  verificationByDay,
  suppressionByDay,
}: Props) {
  const gatePieData = gateDistribution.map((g) => ({
    ...g,
    displayGate: formatGateStatus(g.gate),
    fill: GATE_HEX[g.gate] ?? "#94a3b8",
  }));
  const gateTotal = gateDistribution.reduce((s, g) => s + g.count, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Gate distribution</CardTitle>
          <CardDescription>
            Active contacts (staging + Gate 1 + Gate 2 + Gate 3)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={gateChartConfig}
            className="mx-auto h-[280px] w-full max-w-md [&_.recharts-responsive-container]:aspect-auto"
          >
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={gatePieData}
                dataKey="count"
                nameKey="gate"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                strokeWidth={2}
              >
                {gatePieData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} stroke="var(--background)" />
                ))}
              </Pie>
              <Legend
                verticalAlign="bottom"
                formatter={(value) => {
                  const row = gateDistribution.find((g) => g.gate === value);
                  const n = row?.count ?? 0;
                  const pct =
                    gateTotal > 0 ? Math.round((n / gateTotal) * 1000) / 10 : 0;
                  const label = formatGateStatus(String(value));
                  return `${label} · ${n} (${pct}%)`;
                }}
              />
            </PieChart>
          </ChartContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Staging represents records below the trust floor — not yet promoted from intake.
            The PRD&apos;s three-gate model applies to Gate 1–3 only.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Provider accuracy trend</CardTitle>
          <CardDescription>Per-cycle accuracy from QA sampling</CardDescription>
        </CardHeader>
        <CardContent>
          {providerTrend.insufficient ? (
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <p>Insufficient data — at least 2 QA cycles per provider needed to render trend.</p>
            </div>
          ) : (
            <ChartContainer
              config={trendChartConfig}
              className="h-[280px] w-full [&_.recharts-responsive-container]:aspect-auto"
            >
              <LineChart
                data={providerTrend.rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="cycle"
                  tickLine={false}
                  axisLine={false}
                  label={{ value: "Cycle", position: "insideBottom", offset: -4 }}
                />
                <YAxis
                  domain={[0, 100]}
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: "Accuracy",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                  }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine
                  y={85}
                  stroke="#f59e0b"
                  strokeDasharray="5 5"
                  label={{ value: "85%", position: "right", fill: "#f59e0b", fontSize: 11 }}
                />
                <ReferenceLine
                  y={75}
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  label={{ value: "75%", position: "right", fill: "#ef4444", fontSize: 11 }}
                />
                <Line
                  type="monotone"
                  dataKey="cognism"
                  name="cognism"
                  stroke="var(--color-cognism)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="apollo"
                  name="apollo"
                  stroke="var(--color-apollo)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Verification volume — last 30 days</CardTitle>
          <CardDescription>Daily email verifications by outcome</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={verificationChartConfig}
            className="h-[280px] w-full [&_.recharts-responsive-container]:aspect-auto"
          >
            <BarChart data={verificationByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dayLabel" tickLine={false} axisLine={false} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="valid"
                stackId="a"
                fill="var(--color-valid)"
                radius={[0, 0, 0, 0]}
              />
              <Bar dataKey="invalid" stackId="a" fill="var(--color-invalid)" />
              <Bar dataKey="risky" stackId="a" fill="var(--color-risky)" />
              <Bar
                dataKey="unknown"
                stackId="a"
                fill="var(--color-unknown)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Suppression list growth</CardTitle>
          <CardDescription>Total suppressions created through each day (last 30 days)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={suppressionChartConfig}
            className="h-[280px] w-full [&_.recharts-responsive-container]:aspect-auto"
          >
            <AreaChart data={suppressionByDay} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dayLabel" tickLine={false} axisLine={false} />
              <YAxis width={44} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="total"
                name="total"
                stroke="var(--color-total)"
                fill="var(--color-total)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
