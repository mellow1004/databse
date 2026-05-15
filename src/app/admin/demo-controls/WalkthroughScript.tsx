type Step = {
  action: string;
  why: string;
  expected: string;
};

const STEPS: Step[] = [
  {
    action: "Start on /admin",
    why: "Show the dashboard. Point out the 4 stat cards (total contacts, gate 2 ready, pending quarantine, pending conflicts) and the Recent activity feed.",
    expected:
      "Audience sees baseline counts and a short audit trail from the seed.",
  },
  {
    action: 'Click "Upload CSV"',
    why: 'Select the Brightvision Internal client, source Vendor export, upload samples/test_import.csv. The file has intentional edge cases: invalid emails, duplicates, a tombstoned email, and a tombstoned LinkedIn URL.',
    expected: "6 accepted, 8 rejected. One row blocked by a tombstone from a prior deletion.",
  },
  {
    action: 'Click "View batch detail"',
    why: "Show how each rejection has a reason code. Expand a details row to show the original raw values are preserved.",
    expected:
      "Rejection reasons are visible (duplicate, invalid email, tombstone, etc.) with raw CSV fields intact.",
  },
  {
    action: 'Click "Promote accepted rows"',
    why: "Confirm promotion into the golden record.",
    expected:
      'Green card: "6 new contacts, 3 new companies, 5 new persons, 0 matched existing".',
  },
  {
    action: 'Click "Run verification & enrichment pipeline"',
    why: "Wait 10–15 seconds for the mock providers to run.",
    expected:
      "Green Pipeline card with three sub-cards: verification credits, enrichment + conflicts, gates promoted.",
  },
  {
    action: 'Click "Duplicate review"',
    why: "Switch client to ClientCo Tech. Show 5+ candidates at 95% confidence (seeded duplicates with the same LinkedIn URL). Approve one merge.",
    expected: "merge_history grows; survivor contact retains the newer enrichment.",
  },
  {
    action: 'Click "Resolve conflicts"',
    why: "Pick a conflict, compare Cognism vs Apollo values side by side. Resolve with one provider.",
    expected: "Contact title and seniority update to the chosen provider values.",
  },
  {
    action: 'Click "Quarantine"',
    why: "Show the queue. Release one contact.",
    expected: "Released contact returns to active lifecycle; audit trail records the release.",
  },
  {
    action: 'Click "Platform simulator"',
    why: 'Tab 1: build a targeting list, select 3 contacts, assign to campaign "Demo walkthrough". Tab 2: simulate a bounce on one contact. Tab 3: watch the audit trail.',
    expected:
      "Campaign assignment visible on contacts; bounce suppresses/quarantines as configured; events appear in recent activity.",
  },
  {
    action: 'Click "Analytics"',
    why: "Show operational charts built from live data.",
    expected: "Gate donut, provider trend, verification bar chart, and suppression area chart render.",
  },
  {
    action: 'Click "Bias monitoring"',
    why: "Show the three skew analyses and regulatory framing.",
    expected:
      "Country, headcount, and gender panels with tolerance bands; flagged subgroups highlighted.",
  },
  {
    action: 'Click "Refresh cycle"',
    why: "Run a small cycle (30 contacts) with anonymisation on.",
    expected: "Cost breakdown table with per-provider EUR; past cycles table gains a new row.",
  },
  {
    action: "Return to /admin",
    why: "Close the loop for the audience.",
    expected:
      "Recent activity lists intake, pipeline, merge, conflict, quarantine, simulator, and refresh actions from this session.",
  },
];

export function WalkthroughScript() {
  return (
    <div className="space-y-4">
      <ol className="list-none space-y-3">
        {STEPS.map((step, i) => (
          <li key={i} className="space-y-1">
            <p className="font-medium text-slate-900">
              {i + 1}. {step.action}
            </p>
            <p className="text-sm text-slate-600">{step.why}</p>
            <p className="text-xs italic text-slate-500">
              Expected outcome: {step.expected}
            </p>
          </li>
        ))}
      </ol>
      <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        After demo: visit Demo controls and click Reset to restore baseline for the
        next showing.
      </p>
    </div>
  );
}
