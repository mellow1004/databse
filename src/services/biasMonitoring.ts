import { db } from "@/lib/db";
import type {
  BiasCategorySection,
  BiasMonitoringReport,
  BiasSubgroupRow,
} from "@/lib/bias-monitoring-types";

const MIN_SAMPLE = 20;
const TOLERANCE_PP = 10;

const HEADCOUNT_ORDER = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

const BAR_IN_TOLERANCE = "#2563eb";
const BAR_FLAGGED = "#f59e0b";

type ContactRow = {
  gateStatus: string;
  person: { inferredGender: string | null };
  company: { country: string | null; headcountBand: string | null };
};

function normalizeGender(raw: string | null): "M" | "F" | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "m" || s === "male") return "M";
  if (s === "f" || s === "female") return "F";
  return null;
}

function aggregate(
  contacts: ContactRow[],
  keyFn: (c: ContactRow) => string | null,
): Map<string, { n: number; gate2: number }> {
  const map = new Map<string, { n: number; gate2: number }>();
  for (const c of contacts) {
    const key = keyFn(c);
    if (key === null) continue;
    const cur = map.get(key) ?? { n: 0, gate2: 0 };
    cur.n += 1;
    if (c.gateStatus === "gate_2") cur.gate2 += 1;
    map.set(key, cur);
  }
  return map;
}

function buildRows(
  map: Map<string, { n: number; gate2: number }>,
  overallRate: number,
  labelFn: (key: string) => string,
  sortKeys?: (a: string, b: string) => number,
): BiasSubgroupRow[] {
  const keys = [...map.keys()];
  if (sortKeys) keys.sort(sortKeys);
  else keys.sort();

  const rows: BiasSubgroupRow[] = [];
  for (const key of keys) {
    const { n, gate2 } = map.get(key)!;
    if (n < MIN_SAMPLE) continue;
    const gate2Rate = (100 * gate2) / n;
    const deltaPp = gate2Rate - overallRate;
    const inTolerance = Math.abs(deltaPp) <= TOLERANCE_PP;
    rows.push({
      key,
      label: labelFn(key),
      contacts: n,
      gate2Count: gate2,
      gate2Rate: Math.round(gate2Rate * 10) / 10,
      deltaPp: Math.round(deltaPp * 10) / 10,
      inTolerance,
      barFill: inTolerance ? BAR_IN_TOLERANCE : BAR_FLAGGED,
    });
  }
  return rows;
}

function countSkippedInBuckets(
  contacts: ContactRow[],
  keyFn: (c: ContactRow) => string | null,
): number {
  const map = aggregate(contacts, keyFn);
  let skipped = 0;
  for (const c of contacts) {
    const key = keyFn(c);
    if (key === null) {
      skipped += 1;
      continue;
    }
    const bucket = map.get(key);
    if (!bucket || bucket.n < MIN_SAMPLE) skipped += 1;
  }
  return skipped;
}

function section(
  id: BiasCategorySection["id"],
  title: string,
  description: string,
  rows: BiasSubgroupRow[],
  footnote?: string,
): BiasCategorySection {
  const flaggedCount = rows.filter((r) => !r.inTolerance).length;
  return {
    id,
    title,
    description,
    footnote,
    rows,
    flaggedCount,
    empty: rows.length === 0,
  };
}

export async function computeBiasMonitoringReport(): Promise<BiasMonitoringReport> {
  const contacts = await db.contact.findMany({
    where: { mergedIntoId: null, lifecycleStage: "active" },
    select: {
      gateStatus: true,
      person: { select: { inferredGender: true } },
      company: { select: { country: true, headcountBand: true } },
    },
  });

  const totalActive = contacts.length;
  const overallGate2Count = contacts.filter((c) => c.gateStatus === "gate_2").length;
  const overallRate =
    totalActive > 0
      ? Math.round((100 * overallGate2Count) / totalActive * 10) / 10
      : 0;

  const countryMap = aggregate(contacts, (c) => {
    const code = c.company.country?.trim();
    return code ? code.toUpperCase() : null;
  });
  const countryRows = buildRows(
    countryMap,
    overallRate,
    (k) => k,
  );

  const headcountMap = aggregate(contacts, (c) => {
    const band = c.company.headcountBand?.trim();
    return band || null;
  });
  const headcountOrder = new Map(HEADCOUNT_ORDER.map((b, i) => [b, i]));
  const headcountRows = buildRows(
    headcountMap,
    overallRate,
    (k) => k,
    (a, b) => (headcountOrder.get(a as (typeof HEADCOUNT_ORDER)[number]) ?? 99) -
      (headcountOrder.get(b as (typeof HEADCOUNT_ORDER)[number]) ?? 99),
  );

  const genderMap = aggregate(contacts, (c) => normalizeGender(c.person.inferredGender));
  const genderRows = buildRows(genderMap, overallRate, (k) => k, (a, b) =>
    a === "M" ? -1 : b === "M" ? 1 : a.localeCompare(b),
  );

  const skippedCountry = countSkippedInBuckets(contacts, (c) => {
    const code = c.company.country?.trim();
    return code ? code.toUpperCase() : null;
  });
  const skippedHeadcount = countSkippedInBuckets(contacts, (c) => {
    const band = c.company.headcountBand?.trim();
    return band || null;
  });
  const skippedGender = contacts.filter((c) => {
    const g = normalizeGender(c.person.inferredGender);
    if (g === null) return true;
    const bucket = genderMap.get(g);
    return !bucket || bucket.n < MIN_SAMPLE;
  }).length;

  const totalSkippedSmallSample = Math.max(
    skippedCountry,
    skippedHeadcount,
    skippedGender,
  );

  return {
    overallRate,
    overallGate2Count,
    totalActive,
    totalSkippedSmallSample,
    tolerancePp: TOLERANCE_PP,
    country: section(
      "country",
      "Country skew",
      "Gate_2 rate per country. Countries with < 20 contacts are excluded.",
      countryRows,
    ),
    headcount: section(
      "headcount",
      "Company size skew",
      "Gate_2 rate per headcount band. Bands with < 20 contacts are excluded.",
      headcountRows,
    ),
    gender: section(
      "gender",
      "Inferred gender skew",
      "Gate_2 rate for M vs F (inferred from first name). Buckets with < 20 contacts are excluded.",
      genderRows,
      "Gender is inferred from first name during enrichment. Inference itself is logged as a separate processing activity per AI Act Article 10. Contacts without first-name inference are not included in this analysis.",
    ),
  };
}
