"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  selectedScope: "all" | "global" | "client_level" | "domain_level";
  selectedStatus: "active" | "released" | "all";
};

export default function FilterBar({
  clients,
  selectedClientId,
  selectedScope,
  selectedStatus,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function push(next: {
    clientId?: string;
    scope?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    const clientId =
      next.clientId !== undefined ? next.clientId : selectedClientId;
    const scope = next.scope !== undefined ? next.scope : selectedScope;
    const status = next.status !== undefined ? next.status : selectedStatus;
    if (clientId) params.set("clientId", clientId);
    if (scope && scope !== "all") params.set("scope", scope);
    if (status && status !== "active") params.set("status", status);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <Card className="sticky top-0 z-10 shadow-sm">
      <CardContent className="flex flex-wrap items-end gap-6 pt-6">
        <div className="space-y-2">
          <Label>Client</Label>
          <Select
            value={selectedClientId || "__all__"}
            disabled={pending}
            onValueChange={(v) =>
              push({ clientId: v === "__all__" ? "" : v })
            }
          >
            <SelectTrigger className="w-[220px]">
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
          <Label>Scope</Label>
          <Select
            value={selectedScope}
            disabled={pending}
            onValueChange={(v) => push({ scope: v })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="client_level">Client</SelectItem>
              <SelectItem value="domain_level">Domain</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={selectedStatus}
            disabled={pending}
            onValueChange={(v) => push({ status: v })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
