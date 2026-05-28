"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RetentionActions({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "reactivate" | "queue-anonymisation") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/retention/${contactId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => run("reactivate")} disabled={loading !== null}>
          {loading === "reactivate" ? "Saving…" : "Reactivate"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => run("queue-anonymisation")} disabled={loading !== null}>
          {loading === "queue-anonymisation" ? "Saving…" : "Accept anonymisation"}
        </Button>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
