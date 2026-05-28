"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  summary: {
    overallRate: number;
    countryFlagged: number;
    headcountFlagged: number;
    genderFlagged: number;
  };
};

export function QuarterlyReviewCard({ summary }: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch("/api/bias-monitoring/signoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          summary,
        }),
      });
      if (!res.ok) return;
      setOpen(false);
      setNotes("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Sign off this quarter&apos;s review</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quarterly bias review sign-off</DialogTitle>
        </DialogHeader>
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Acknowledge the review and note follow-up actions..."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={loading}>
            {loading ? "Signing off..." : "Sign off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
