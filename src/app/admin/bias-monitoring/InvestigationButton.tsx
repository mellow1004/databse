"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  category: string;
  subgroup: string;
  contacts: number;
  rate: number;
  deltaPp: number;
};

export function InvestigationButton(props: Props) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/bias-monitoring/investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(props),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Investigation logging failed");
        return;
      }
      toast.success("Investigation logged");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onClick}>
      Open investigation
    </Button>
  );
}
