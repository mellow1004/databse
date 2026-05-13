import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/db";
import ConflictsClientFilter from "./ConflictsClientFilter";

export const dynamic = "force-dynamic";

function parseField(raw: string | null): string {
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.field === "string") return parsed.field;
  } catch {
    /* fall through */
  }
  return "—";
}

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

export default async function ConflictsQueuePage({
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
          <h1 className="text-2xl font-semibold tracking-tight">Enrichment conflicts</h1>
          <p className="text-sm text-slate-600">
            No clients found — run <code className="font-mono text-xs">npm run db:seed</code>{" "}
            first.
          </p>
        </div>
      </div>
    );
  }
  const currentClientId =
    sp.clientId && clients.some((c) => c.id === sp.clientId)
      ? sp.clientId
      : clients[0]!.id;
  const currentClient = clients.find((c) => c.id === currentClientId)!;

  const rows = await db.enrichmentLog.findMany({
    where: { clientId: currentClientId, status: "conflict_pending" },
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
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  const distinctContacts = new Set(contactIds).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enrichment conflicts</h1>
        <p className="text-sm text-slate-600">
          Fields where Cognism and Apollo disagreed within the confidence-delta threshold.
        </p>
      </div>

      <ConflictsClientFilter clients={clients} currentClientId={currentClientId} />

      <p className="text-sm text-slate-600">
        <span className="font-semibold tabular-nums text-slate-900">{rows.length}</span>{" "}
        conflict{rows.length === 1 ? "" : "s"} pending across{" "}
        <span className="font-semibold tabular-nums text-slate-900">
          {distinctContacts}
        </span>{" "}
        contact{distinctContacts === 1 ? "" : "s"} in{" "}
        <span className="font-medium text-slate-800">{currentClient.name}</span>.
      </p>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead className="w-28"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-16">
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <CheckCircle2 className="size-12 text-emerald-400" aria-hidden />
                      <p className="text-sm text-slate-600">
                        All clear — no pending conflicts for this client.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const c = r.contactId ? contactsById.get(r.contactId) : null;
                  const name = c?.person.fullName ?? "(missing contact)";
                  const company = c?.company.legalName ?? "—";
                  const field = parseField(r.rawResponse);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {r.contactId ? (
                          <div>
                            <Link
                              href={`/admin/contacts/${r.contactId}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {name}
                            </Link>
                            {c?.person.primaryEmail ?? c?.email ? (
                              <div className="text-xs text-muted-foreground">
                                {c?.person.primaryEmail ?? c?.email}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          name
                        )}
                      </TableCell>
                      <TableCell className="text-slate-700">{company}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{field}</code>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {relativeTime(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        {r.contactId ? (
                          <Button variant="link" className="h-auto px-0" asChild>
                            <Link href={`/admin/contacts/${r.contactId}#conflicts`}>
                              Resolve →
                            </Link>
                          </Button>
                        ) : (
                          "—"
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
