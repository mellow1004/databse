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
  selectedProvider: "cognism" | "apollo";
};

export default function AccuracyNavBar({
  clients,
  selectedClientId,
  selectedProvider,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function push(next: { clientId?: string; provider?: string }) {
    const params = new URLSearchParams();
    const clientId =
      next.clientId !== undefined ? next.clientId : selectedClientId;
    const provider =
      next.provider !== undefined ? next.provider : selectedProvider;
    if (clientId) params.set("clientId", clientId);
    if (provider && provider !== "cognism") params.set("provider", provider);
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
            value={selectedClientId}
            disabled={pending}
            onValueChange={(v) => push({ clientId: v })}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Provider (queue + trend)</Label>
          <Select
            value={selectedProvider}
            disabled={pending}
            onValueChange={(v) => push({ provider: v })}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cognism">Cognism</SelectItem>
              <SelectItem value="apollo">Apollo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
