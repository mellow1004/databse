"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ClientOption = { id: string; name: string };

type Props = {
  clients: ClientOption[];
  selectedClientId: string;
  selectedReviewState: "pending" | "reviewed" | "released" | "all";
  selectedReasonCode:
    | "all"
    | "bounce"
    | "verification_failure"
    | "gdpr_request"
    | "manual_flag"
    | "accuracy_failure";
  selectedApprovalPath: "all" | "auto" | "manual";
};

export default function QuarantineFilterBar({
  clients,
  selectedClientId,
  selectedReviewState,
  selectedReasonCode,
  selectedApprovalPath,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function push(next: {
    clientId?: string;
    reviewState?: string;
    reasonCode?: string;
    approvalPath?: string;
  }) {
    const params = new URLSearchParams();
    const clientId =
      next.clientId !== undefined ? next.clientId : selectedClientId;
    const reviewState =
      next.reviewState !== undefined ? next.reviewState : selectedReviewState;
    const reasonCode =
      next.reasonCode !== undefined ? next.reasonCode : selectedReasonCode;
    const approvalPath =
      next.approvalPath !== undefined ? next.approvalPath : selectedApprovalPath;
    if (clientId) params.set("clientId", clientId);
    if (reviewState && reviewState !== "pending") params.set("reviewState", reviewState);
    if (reasonCode && reasonCode !== "all") params.set("reasonCode", reasonCode);
    if (approvalPath && approvalPath !== "all") params.set("approvalPath", approvalPath);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div className="sticky top-0 z-10 -mx-6 mb-4 border-b bg-slate-50 px-6 py-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>Client</Label>
          <Select
            value={selectedClientId || "__all__"}
            disabled={pending}
            onValueChange={(v) => push({ clientId: v === "__all__" ? "" : v })}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Review state</Label>
          <Select
            value={selectedReviewState}
            disabled={pending}
            onValueChange={(v) => push({ reviewState: v })}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Select
            value={selectedReasonCode}
            disabled={pending}
            onValueChange={(v) => push({ reasonCode: v })}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="bounce">bounce</SelectItem>
              <SelectItem value="verification_failure">verification_failure</SelectItem>
              <SelectItem value="gdpr_request">gdpr_request</SelectItem>
              <SelectItem value="manual_flag">manual_flag</SelectItem>
              <SelectItem value="accuracy_failure">accuracy_failure</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Path</Label>
          <Select
            value={selectedApprovalPath}
            disabled={pending}
            onValueChange={(v) => push({ approvalPath: v })}
          >
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
