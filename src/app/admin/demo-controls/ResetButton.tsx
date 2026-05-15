"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ResetResponse = {
  resetAt: string;
  contacts: number;
  suppressions: number;
  error?: string;
  message?: string;
};

export function ResetButton() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);

  async function handleReset() {
    if (
      !window.confirm(
        "This will wipe all dynamic demo data (batches, campaigns, merges, refresh cycles, etc.) and restore the database to the seeded baseline. Continue?",
      )
    ) {
      return;
    }

    const typed = window.prompt('Type RESET to confirm:');
    if (typed !== "RESET") {
      return;
    }

    setIsResetting(true);
    toast.info("Resetting database...");

    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = (await res.json()) as ResetResponse;

      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Reset failed");
        return;
      }

      toast.success(
        `Demo state restored — ${data.contacts} contacts, ${data.suppressions} suppressions seeded.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isResetting}
      onClick={handleReset}
    >
      {isResetting ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RotateCcw className="size-4" aria-hidden />
      )}
      Reset to seed baseline
    </Button>
  );
}
