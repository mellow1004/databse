"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  suppressionId: string;
};

/**
 * Per-row "Release" trigger. Asks for a reason via window.prompt so the
 * action stays auditable. On success the server component is refreshed and
 * the row flips into its released-state rendering.
 */
export default function ReleaseButton({ suppressionId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    const reason = window.prompt("Reason for releasing this suppression:");
    if (reason === null) return; // user cancelled
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A non-empty reason is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suppressions/${suppressionId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="text-xs text-red-700 hover:text-red-800 underline disabled:opacity-50"
      >
        {loading ? "Releasing…" : "Release"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
