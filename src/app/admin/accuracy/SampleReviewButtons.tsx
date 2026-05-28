"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  sampleId: string;
  fieldLabel: string;
};

export default function SampleReviewButtons({ sampleId, fieldLabel }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function postReview(isCorrect: boolean, actualValue?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accuracy/${sampleId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCorrect, actualValue }),
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

  async function onCorrect() {
    await postReview(true);
  }

  async function onIncorrect() {
    const actual = window.prompt(`What's the actual ${fieldLabel}?`);
    if (actual === null) return;
    const trimmed = actual.trim();
    if (!trimmed) {
      setError(`Actual ${fieldLabel} is required for an incorrect mark.`);
      return;
    }
    await postReview(false, trimmed);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={onCorrect}
          disabled={loading}
        >
          <Check className="size-3.5" aria-hidden />
          Mark correct
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="gap-1.5"
          onClick={onIncorrect}
          disabled={loading}
        >
          <X className="size-3.5" aria-hidden />
          Mark incorrect
        </Button>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
