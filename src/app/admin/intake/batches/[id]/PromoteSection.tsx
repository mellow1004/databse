"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Promote to master database</CardTitle>
            <CardDescription>Nothing to promote for this batch.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTitle>All rows rejected</AlertTitle>
              <AlertDescription>
                Nothing to promote — all rows in this batch were rejected.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Promote to master database</CardTitle>
          <CardDescription>
            {rowsAccepted} accepted rows are ready to be moved into contacts/companies.
            Identity resolution will match them to existing records or create new ones.
            New contacts start at gate_1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" onClick={onPromote} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {loading ? "Promoting…" : "Promote accepted rows"}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (status === "completed") {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Promoted to master database</CardTitle>
          <CardDescription>Promotion outcome for this batch.</CardDescription>
        </CardHeader>
        <CardContent>
          {existingOutcome ? (
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">New persons</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {existingOutcome.newPersons}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">New companies</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {existingOutcome.newCompanies}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">New contacts</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {existingOutcome.newContacts}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Matched existing</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {existingOutcome.matchedExistingContacts}
                </p>
              </div>
            </div>
          ) : (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
              <AlertTitle>Complete</AlertTitle>
              <AlertDescription>{rowsPromoted} rows promoted.</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  if (status === "promoting") {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Promotion in progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>Status: promoting</AlertTitle>
            <AlertDescription>
              Rows are being written to the master database — this may take a moment.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Batch failed</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Status: failed</AlertTitle>
            <AlertDescription>
              This batch did not complete successfully. Check logs or re-upload.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return null;
}
