"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function DemoteProviderButton({
  provider,
  cycleNumber,
  accuracyRate,
}: {
  provider: string;
  cycleNumber: number;
  accuracyRate: number;
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/provider-governance/demote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, cycleNumber, accuracyRate }),
      });
      if (res.ok) setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={loading || done}>
      {done ? "Demotion logged" : loading ? "Logging..." : "Demote in waterfall"}
    </Button>
  );
}
