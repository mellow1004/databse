import { Suspense } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import type { ActiveCampaignRow, RecentSimulatorEvent } from "./types";
import { SimulatorClient } from "./SimulatorClient";

export const dynamic = "force-dynamic";

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function buildRecentEvents(): Promise<RecentSimulatorEvent[]> {
  const rows = await db.auditLog.findMany({
    where: {
      action: {
        in: ["campaign_assigned", "bounce_event_received", "reply_event_received"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      action: true,
      afterState: true,
      resourceId: true,
      createdAt: true,
    },
  });

  const contactIds = new Set<string>();
  for (const r of rows) {
    if (r.resourceId) contactIds.add(r.resourceId);
    if (r.action === "campaign_assigned" && r.afterState) {
      try {
        const j = JSON.parse(r.afterState) as { contactIds?: string[] };
        if (Array.isArray(j.contactIds)) {
          for (const id of j.contactIds) {
            if (typeof id === "string") contactIds.add(id);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const contacts = contactIds.size
    ? await db.contact.findMany({
        where: { id: { in: [...contactIds] } },
        include: { person: { select: { fullName: true } } },
      })
    : [];
  const nameById = new Map(contacts.map((c) => [c.id, c.person.fullName]));

  function labelFor(r: (typeof rows)[0]): string {
    if (r.resourceId) {
      const n = nameById.get(r.resourceId);
      if (n) return n;
    }
    if (r.action === "campaign_assigned" && r.afterState) {
      try {
        const j = JSON.parse(r.afterState) as {
          contactIds?: string[];
          campaignLabel?: string;
        };
        if (Array.isArray(j.contactIds) && j.contactIds.length) {
          return `${j.contactIds.length} contact(s) — ${j.campaignLabel ?? "Campaign"}`;
        }
      } catch {
        /* ignore */
      }
    }
    return r.resourceId ? `Contact ${r.resourceId.slice(0, 8)}…` : "—";
  }

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    createdAt: r.createdAt.toISOString(),
    afterState: r.afterState,
    resourceId: r.resourceId,
    resourceLabel: labelFor(r),
  }));
}

export default async function PlatformSimPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (clients.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            AI SDR Platform Simulator
          </h1>
          <p className="text-sm text-slate-600">
            No clients in the database — run <code className="font-mono text-xs">npm run db:seed</code>{" "}
            first.
          </p>
        </div>
      </div>
    );
  }

  const selectedClientId =
    sp.clientId && clients.some((c) => c.id === sp.clientId)
      ? sp.clientId
      : (clients[0]?.id ?? "");

  const dayStart = startOfLocalDay(new Date());

  const [
    initialActiveCount,
    suppressionsTodayAiSdr,
    activeCampaignRows,
    recentEvents,
  ] = await Promise.all([
    db.contact.count({ where: { campaignActive: true } }),
    db.suppression.count({
      where: {
        source: "ai_sdr_platform",
        createdAt: { gte: dayStart },
      },
    }),
    selectedClientId
      ? db.contact.findMany({
          where: { clientId: selectedClientId, campaignActive: true },
          include: {
            person: { select: { fullName: true, primaryEmail: true } },
            company: { select: { legalName: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 200,
        })
      : Promise.resolve([]),
    buildRecentEvents(),
  ]);

  const activeCampaign: ActiveCampaignRow[] = activeCampaignRows.map((c) => ({
    id: c.id,
    fullName: c.person.fullName,
    email: c.email ?? c.person.primaryEmail ?? null,
    companyName: c.company.legalName,
    gateStatus: c.gateStatus,
    lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          AI SDR Platform Simulator
        </h1>
        <p className="text-sm text-slate-600">
          Simulate targeting queries, campaign assignment, and inbound events to
          demonstrate how the master database reacts to external signals.
        </p>
      </div>

      <Alert>
        <Info className="size-4 shrink-0" aria-hidden />
        <AlertDescription>
          This page simulates the API contract between the master database and a
          hypothetical AI SDR platform. In production, these actions would be triggered by
          an external system.
        </AlertDescription>
      </Alert>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Read/Write contract</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Reads</p>
            <ul className="space-y-1 text-sm text-slate-600">
              <li><code>GET /api/ai-sdr/targeting</code> (gate_2 + suppression filter)</li>
              <li><code>GET /api/contacts/[id]</code> (contact details)</li>
              <li><code>GET /api/contacts/[id]#gate-status</code></li>
              <li><code>GET /api/suppressions</code></li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Writes</p>
            <ul className="space-y-1 text-sm text-slate-600">
              <li><code>POST /api/ai-sdr/campaign</code> (campaign assignments)</li>
              <li><code>POST /api/ai-sdr/bounce</code> (bounce events)</li>
              <li><code>POST /api/ai-sdr/reply</code> (reply events)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Suspense
        fallback={
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
            Loading simulator…
          </div>
        }
      >
        <SimulatorClient
          clients={clients}
          selectedClientId={selectedClientId}
          initialActiveCount={initialActiveCount}
          suppressionsTodayAiSdr={suppressionsTodayAiSdr}
          activeCampaign={activeCampaign}
          recentEvents={recentEvents}
        />
      </Suspense>
    </div>
  );
}
