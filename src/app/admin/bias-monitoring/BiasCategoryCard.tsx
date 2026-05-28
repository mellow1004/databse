"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStatusVariant } from "@/lib/badge-helpers";
import type { BiasCategorySection } from "@/lib/bias-monitoring-types";
import { InvestigationButton } from "./InvestigationButton";

const CHART_PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"];

const chartConfig = {
  rate: { label: "Gate 2 rate", color: CHART_PALETTE[0] },
} satisfies ChartConfig;

type Props = {
  section: BiasCategorySection;
  overallRate: number;
};

export function BiasCategoryCard({ section, overallRate }: Props) {
  const verdict =
    section.empty || section.flaggedCount === 0 ? (
      <Badge className={getStatusVariant("valid")}>✓ Within tolerance</Badge>
    ) : (
      <Badge className={getStatusVariant("risky")}>
        ⚠ {section.flaggedCount} subgroup{section.flaggedCount === 1 ? "" : "s"} flagged
      </Badge>
    );

  const chartData = section.rows.map((r) => ({
    label: r.label,
    rate: r.gate2Rate,
    fill: r.barFill,
  }));

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 space-y-1.5">
          <CardTitle>{section.title}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </div>
        <div className="shrink-0">{verdict}</div>
      </CardHeader>
      <CardContent className="space-y-6">
        {section.empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Not enough data to analyse this dimension. Need at least 20 contacts per
            subgroup.
          </p>
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              className="h-[280px] w-full [&_.recharts-responsive-container]:aspect-auto"
            >
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, "auto"]}
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="tabular-nums">{Number(value).toFixed(1)}%</span>
                      )}
                    />
                  }
                />
                <ReferenceLine
                  y={overallRate}
                  stroke="#94a3b8"
                  strokeDasharray="5 5"
                  label={{
                    value: `Overall ${overallRate}%`,
                    position: "right",
                    fill: "#94a3b8",
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="rate" name="rate" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {section.id === "country"
                      ? "Country"
                      : section.id === "headcount"
                        ? "Headcount band"
                        : "Gender"}
                  </TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                  <TableHead className="text-right">Gate_2</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Delta from overall</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.contacts}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.gate2Count}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.gate2Rate}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.deltaPp > 0 ? "+" : ""}
                      {r.deltaPp.toFixed(1)} pp
                    </TableCell>
                    <TableCell>
                      {r.inTolerance ? (
                        <Badge className={getStatusVariant("valid")}>✓</Badge>
                      ) : (
                        <Badge className={getStatusVariant("risky")}>⚠ Flagged</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.inTolerance ? null : (
                        <InvestigationButton
                          category={section.id}
                          subgroup={r.label}
                          contacts={r.contacts}
                          rate={r.gate2Rate}
                          deltaPp={r.deltaPp}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {section.footnote ? (
          <p className="text-xs text-muted-foreground">{section.footnote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
