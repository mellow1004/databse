import { db } from "@/lib/db";

export type CallingWeekRow = {
  weekKey: string;
  weekLabel: string;
  no_answer: number;
  callback: number;
  qualified_interview: number;
  decline: number;
  wrong_number: number;
  answer_no_interview: number;
};

export type CallingActivityMetrics = {
  totalCalls: number;
  answerRate: number;
  qualifiedInterviewRate: number;
  callbackRate: number;
  wrongNumberRate: number;
  byWeek: CallingWeekRow[];
};

function weekStartKey(d: Date): string {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function weekLabelFromKey(key: string): string {
  const [, m, d] = key.split("-");
  return `Wk ${m}/${d}`;
}

export async function getCallingActivityMetrics(filters: {
  clientId?: string;
}): Promise<CallingActivityMetrics> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const calls = await db.otto2Call.findMany({
    where: {
      calledAt: { gte: since },
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
    },
    select: { outcome: true, calledAt: true },
  });

  const totalCalls = calls.length;
  const answered = calls.filter((c) => c.outcome !== "no_answer").length;
  const qualified = calls.filter((c) => c.outcome === "qualified_interview").length;
  const callbacks = calls.filter((c) => c.outcome === "callback").length;
  const wrong = calls.filter((c) => c.outcome === "wrong_number").length;

  const weekBuckets = new Map<string, CallingWeekRow>();
  for (const call of calls) {
    const key = weekStartKey(new Date(call.calledAt));
    const row =
      weekBuckets.get(key) ??
      ({
        weekKey: key,
        weekLabel: weekLabelFromKey(key),
        no_answer: 0,
        callback: 0,
        qualified_interview: 0,
        decline: 0,
        wrong_number: 0,
        answer_no_interview: 0,
      } satisfies CallingWeekRow);
    if (call.outcome === "no_answer") row.no_answer += 1;
    else if (call.outcome === "callback") row.callback += 1;
    else if (call.outcome === "qualified_interview") row.qualified_interview += 1;
    else if (call.outcome === "decline") row.decline += 1;
    else if (call.outcome === "wrong_number") row.wrong_number += 1;
    else if (call.outcome === "answer_no_interview") row.answer_no_interview += 1;
    weekBuckets.set(key, row);
  }

  const byWeek = [...weekBuckets.values()].sort((a, b) =>
    a.weekKey.localeCompare(b.weekKey),
  );

  return {
    totalCalls,
    answerRate: totalCalls > 0 ? (answered / totalCalls) * 100 : 0,
    qualifiedInterviewRate: totalCalls > 0 ? (qualified / totalCalls) * 100 : 0,
    callbackRate: totalCalls > 0 ? (callbacks / totalCalls) * 100 : 0,
    wrongNumberRate: totalCalls > 0 ? (wrong / totalCalls) * 100 : 0,
    byWeek,
  };
}
