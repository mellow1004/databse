import Link from "next/link";
import { FilterX } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import {
  getQuarantineReasonVariant,
  getQuarantineReviewStateVariant,
} from "@/lib/badge-helpers";
import QuarantineFilterBar from "./QuarantineFilterBar";
import QuarantineRowActions from "./QuarantineRowActions";

export const dynamic = "force-dynamic";

function relativeTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

type ReviewFilter = "pending" | "reviewed" | "released" | "all";
type ReasonFilter =
  | "all"
  | "bounce"
  | "verification_failure"
  | "gdpr_request"
  | "manual_flag"
  | "accuracy_failure";

const REASON_CODES: ReasonFilter[] = [
  "all",
  "bounce",
  "verification_failure",
  "gdpr_request",
  "manual_flag",
  "accuracy_failure",
];

export default async function QuarantineReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; reviewState?: string; reasonCode?: string }>;
}) {
  const sp = await searchParams;

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const requestedClientId = sp.clientId ?? "";
  const selectedClientId =
    requestedClientId && clients.some((c) => c.id === requestedClientId)
      ? requestedClientId
      : "";

  const rs = (sp.reviewState ?? "pending").toLowerCase();
  const selectedReviewState: ReviewFilter =
    rs === "reviewed" || rs === "released" || rs === "all" ? (rs as ReviewFilter) : "pending";

  const rc = (sp.reasonCode ?? "all").toLowerCase();
  const selectedReasonCode: ReasonFilter = REASON_CODES.includes(rc as ReasonFilter)
    ? (rc as ReasonFilter)
    : "all";

  const globalPendingCount = await db.quarantineLog.count({
    where: { reviewState: "pending" },
  });

  const where: Prisma.QuarantineLogWhereInput = {};
  if (selectedClientId) where.clientId = selectedClientId;
  if (selectedReviewState !== "all") where.reviewState = selectedReviewState;
  if (selectedReasonCode !== "all") where.reasonCode = selectedReasonCode;

  const rows = await db.quarantineLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const contactIds = Array.from(
    new Set(rows.map((r) => r.contactId).filter((id): id is string => Boolean(id))),
  );

  const contacts = contactIds.length
    ? await db.contact.findMany({
        where: { id: { in: contactIds } },
        include: {
          person: { select: { fullName: true, primaryEmail: true } },
          company: { select: { legalName: true } },
        },
      })
    : [];

  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const actorIds = Array.from(new Set(rows.map((r) => r.actor)));
  const releasedByIds = Array.from(
    new Set(rows.map((r) => r.releasedBy).filter((id): id is string => Boolean(id))),
  );
  const userIds = Array.from(new Set([...actorIds, ...releasedByIds])).filter((id) =>
    /^[a-z0-9]{20,}$/i.test(id),
  );

  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullName: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  function actorLabel(actor: string): string {
    const u = userById.get(actor);
    if (u) return u.fullName;
    return actor;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Quarantine review</h1>
        <Badge variant="secondary" className="tabular-nums">
          {globalPendingCount} pending across all clients
        </Badge>
      </div>
      <p className="text-sm text-slate-600">
        Contacts removed from active campaigns pending Data Owner review.
      </p>

      <QuarantineFilterBar
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        selectedClientId={selectedClientId}
        selectedReviewState={selectedReviewState}
        selectedReasonCode={selectedReasonCode}
      />

      <p className="text-sm text-slate-600">
        Showing{" "}
        <span className="font-semibold tabular-nums text-slate-900">{rows.length}</span> log
        {rows.length === 1 ? "" : "s"} for the current filters.
      </p>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Review state</TableHead>
                <TableHead className="w-52">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16">
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <FilterX className="size-12 text-muted-foreground/80" aria-hidden />
                      <p className="text-sm text-slate-600">
                        No quarantined contacts match these filters.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const c = r.contactId ? contactById.get(r.contactId) : undefined;
                  const personEmail = c?.person.primaryEmail ?? c?.email ?? null;
                  const mergedIntoId = c?.mergedIntoId ?? null;

                  return (
                    <TableRow key={r.id}>
                      <TableCell className="align-top">
                        {c ? (
                          <div>
                            <Link
                              href={`/admin/contacts/${c.id}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {c.person.fullName}
                            </Link>
                            <div className="mt-0.5 break-all text-xs text-muted-foreground">
                              {personEmail ?? (
                                <span className="italic text-muted-foreground/80">
                                  (no email)
                                </span>
                              )}
                            </div>
                          </div>
                        ) : r.contactId ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {r.contactId.slice(0, 12)}…
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-xs text-slate-700">
                        {c?.company?.legalName ?? "—"}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge className={getQuarantineReasonVariant(r.reasonCode)}>
                          {r.reasonCode}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[220px] align-top text-xs text-slate-700">
                        {truncate(r.reasonDetail, 80)}
                      </TableCell>
                      <TableCell className="align-top text-xs">{actorLabel(r.actor)}</TableCell>
                      <TableCell className="align-top text-xs tabular-nums text-muted-foreground">
                        {relativeTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge className={getQuarantineReviewStateVariant(r.reviewState)}>
                          {r.reviewState}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        {r.reviewState === "released" ? (
                          <div className="text-xs text-muted-foreground">
                            <div>
                              Released {fmtDate(r.releasedAt)} by{" "}
                              {r.releasedBy
                                ? (userById.get(r.releasedBy)?.fullName ??
                                  `${r.releasedBy.slice(0, 8)}…`)
                                : "—"}
                            </div>
                            {r.releaseReason ? (
                              <div className="mt-1 text-[11px] italic">{r.releaseReason}</div>
                            ) : null}
                          </div>
                        ) : (
                          <QuarantineRowActions
                            quarantineLogId={r.id}
                            reviewState={r.reviewState}
                            mergedIntoId={mergedIntoId}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
