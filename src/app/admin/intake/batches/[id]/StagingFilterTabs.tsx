"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  batchId: string;
  filter: "all" | "accepted" | "rejected";
  counts: { all: number; accepted: number; rejected: number };
};

export function StagingFilterTabs({ batchId, filter, counts }: Props) {
  const router = useRouter();
  const value = filter;

  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        const href =
          v === "all"
            ? `/admin/intake/batches/${batchId}`
            : `/admin/intake/batches/${batchId}?status=${v}`;
        router.push(href);
      }}
    >
      <TabsList>
        <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        <TabsTrigger value="accepted">Accepted ({counts.accepted})</TabsTrigger>
        <TabsTrigger value="rejected">Rejected ({counts.rejected})</TabsTrigger>
      </TabsList>
      <TabsContent value="all" hidden className="hidden" />
      <TabsContent value="accepted" hidden className="hidden" />
      <TabsContent value="rejected" hidden className="hidden" />
    </Tabs>
  );
}
