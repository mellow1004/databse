"use client";

import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CallingWeekRow } from "@/services/otto2Analytics";

const outcomeChartConfig = {
  no_answer: { label: "No answer", color: "#94a3b8" },
  callback: { label: "Callback", color: "#2563eb" },
  qualified_interview: { label: "Qualified interview", color: "#10b981" },
  decline: { label: "Decline", color: "#f59e0b" },
  wrong_number: { label: "Wrong number", color: "#ef4444" },
  answer_no_interview: { label: "Answer (no interview)", color: "#8b5cf6" },
} satisfies ChartConfig;

type Props = {
  byWeek: CallingWeekRow[];
};

export function CallingActivityCharts({ byWeek }: Props) {
  return (
    <Card className="shadow-sm lg:col-span-2">
      <CardHeader>
        <CardTitle>Call outcomes by week</CardTitle>
      </CardHeader>
      <CardContent>
        {byWeek.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No Otto 2 calls in the last 30 days.
          </p>
        ) : (
          <ChartContainer
            config={outcomeChartConfig}
            className="h-[280px] w-full [&_.recharts-responsive-container]:aspect-auto"
          >
            <BarChart data={byWeek} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="weekLabel" tickLine={false} axisLine={false} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Bar dataKey="no_answer" stackId="a" fill="var(--color-no_answer)" />
              <Bar dataKey="callback" stackId="a" fill="var(--color-callback)" />
              <Bar
                dataKey="qualified_interview"
                stackId="a"
                fill="var(--color-qualified_interview)"
              />
              <Bar dataKey="decline" stackId="a" fill="var(--color-decline)" />
              <Bar dataKey="wrong_number" stackId="a" fill="var(--color-wrong_number)" />
              <Bar
                dataKey="answer_no_interview"
                stackId="a"
                fill="var(--color-answer_no_interview)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
