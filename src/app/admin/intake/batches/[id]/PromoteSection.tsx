"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ExistingOutcome = {
  newPersons: number;
  newCompanies: number;
  newContacts: number;
  matchedExistingContacts: number;
};

type Props = {
  batchId: string;
  status: string;
  rowsAccepted: number;
  rowsPromoted: number;
  existingOutcome?: ExistingOutcome | null;
};

/**
 * Renders a single coloured card that varies by batch state:
 *   - ready_for_review + rowsAccepted > 0 → blue: shows the Promote button
 *   - ready_for_review + rowsAccepted = 0 → gray: nothing to do
 *   - promoting                            → yellow: in flight
 *   - completed                            → green: 4-count summary card
 *   - failed                               → red: surfaces the bad state
 *
 * The button POSTs to /api/intake/batches/:id/promote, then triggers a
 * router.refresh() so the server component re-queries the batch and the card
 * re-renders in its post-promotion form.
 */
export default function PromoteSection({
  batchId,
  status,
  rowsAccepted,
  rowsPromoted,
  existingOutcome,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPromote() {
    const ok = window.confirm(
      `Promote ${rowsAccepted} rows into the master database? This creates persons, companies, and contacts. The action is logged.`,
    );
    if (!ok) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/batches/${batchId}/promote`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
      } else {
        // The page is a server component with force-dynamic — refresh re-runs
        // its data fetch and re-renders this section in its post-promotion form.
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (status === "ready_for_review") {
    if (rowsAccepted === 0) {
      return (
        <div className="mb-4 p-4 rounded border border-gray-300 bg-gray-50">
          <p className="text-sm text-gray-700">
            Nothing to promote — all rows in this batch were rejected.
          </p>
        </div>
      );
    }

    return (
      <div className="mb-4 p-4 rounded border border-blue-300 bg-blue-50">
        <h2 className="font-medium text-blue-900">Promote to master database</h2>
        <p className="mt-1 text-sm text-blue-800">
          {rowsAccepted} accepted rows are ready to be moved into
          contacts/companies. Identity resolution will match them to existing
          records or create new ones. New contacts start at gate_1.
        </p>
        <button
          type="button"
          onClick={onPromote}
          disabled={loading}
          className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Promoting…" : "Promote accepted rows"}
        </button>
        {error && <p className="mt-2 text-sm text-red-700">Error: {error}</p>}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="mb-4 p-4 rounded border border-green-300 bg-green-50">
        <h2 className="font-medium text-green-900">Promoted to master database</h2>
        {existingOutcome ? (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-600">New persons</div>
              <div className="text-lg font-medium text-green-900 tabular-nums">
                {existingOutcome.newPersons}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">New companies</div>
              <div className="text-lg font-medium text-green-900 tabular-nums">
                {existingOutcome.newCompanies}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">New contacts</div>
              <div className="text-lg font-medium text-green-900 tabular-nums">
                {existingOutcome.newContacts}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Matched existing</div>
              <div className="text-lg font-medium text-green-900 tabular-nums">
                {existingOutcome.matchedExistingContacts}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-green-800">
            {rowsPromoted} rows promoted.
          </p>
        )}
      </div>
    );
  }

  if (status === "promoting") {
    return (
      <div className="mb-4 p-4 rounded border border-yellow-300 bg-yellow-50">
        <p className="text-sm text-yellow-900">
          Status: <span className="font-medium">promoting</span> — in
          progress…
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mb-4 p-4 rounded border border-red-300 bg-red-50">
        <p className="text-sm text-red-900">
          Status: <span className="font-medium">failed</span>.
        </p>
      </div>
    );
  }

  // "uploaded" is a transient pre-intake state; render nothing rather than
  // mislead the user with an inactive card.
  return null;
}
