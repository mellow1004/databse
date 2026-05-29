"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  clientId: string;
  provider: string;
  nextCycle: number;
  disabled?: boolean;
};

export default function DrawSampleButton({
  clientId,
  provider,
  nextCycle,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accuracy/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, provider, cycleNumber: nextCycle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="default"
        className="w-full sm:w-auto"
        onClick={onClick}
        disabled={loading || disabled}
      >
        {loading ? "Drawing…" : "Draw new sample"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
