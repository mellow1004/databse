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

type ClientOption = { id: string; name: string };

type Props = {
  clients: ClientOption[];
  currentClientId: string;
};

export default function ConflictsClientFilter({
  clients,
  currentClientId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-2">
        <Label htmlFor="conflict-client">Client</Label>
        <Select
          value={currentClientId}
          disabled={pending}
          onValueChange={(clientId) => {
            startTransition(() => {
              const q = new URLSearchParams();
              q.set("clientId", clientId);
              router.push(`${pathname}?${q.toString()}`);
            });
          }}
        >
          <SelectTrigger id="conflict-client" className="w-[240px]">
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
    </div>
  );
}
