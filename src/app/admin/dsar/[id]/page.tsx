import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";
import DsarCaseActions from "./DsarCaseActions";

export const dynamic = "force-dynamic";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    return [];
  } catch {
    return [];
  }
}

function daysUntil(deadline: Date): string {
  const days = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  if (days >= 0) return `${days} days remaining`;
  return `OVERDUE BY ${Math.abs(days)} DAYS`;
}

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function DsarCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dsarCase = await db.dsarCase.findUnique({ where: { id } });
  if (!dsarCase) notFound();

  const owner = await db.user.findUnique({
    where: { id: dsarCase.ownerId },
    select: { id: true, fullName: true },
  });
  const actions = await db.dsarAction.findMany({
    where: { caseId: id },
    orderBy: { createdAt: "desc" },
  });
  const actorIds = [...new Set(actions.map((a) => a.actorUserId))];
  const actors = actorIds.length
    ? await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a.fullName]));

  const matchedIds = parseIds(dsarCase.matchedContactIds);
  const matchedContacts = matchedIds.length
    ? await db.contact.findMany({
        where: { id: { in: matchedIds } },
        include: {
          person: { select: { fullName: true, linkedinUrl: true, primaryPhone: true } },
          company: { select: { id: true, legalName: true } },
        },
      })
    : [];
  const matchCriteria = {
    email: dsarCase.subjectEmail,
    linkedin: dsarCase.subjectLinkedinUrl,
    phone: dsarCase.subjectPhone,
    name: dsarCase.subjectName,
  };

  const allConfirmed =
    dsarCase.tombstoneCreated &&
    dsarCase.aiTrainingDatasetNotified &&
    dsarCase.aiSdrPlatformNotified &&
    dsarCase.subProcessorsNotified;

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">{dsarCase.caseNumber}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Owner: {owner?.fullName ?? dsarCase.ownerId} · Received {fmtDateTime(dsarCase.receivedAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={getStatusVariant(dsarCase.status)}>{dsarCase.status}</Badge>
              <Badge variant="outline">{dsarCase.caseType}</Badge>
              <span
                className={`text-sm font-medium ${
                  dsarCase.deadlineAt.getTime() < Date.now() ? "text-rose-700" : "text-slate-700"
                }`}
              >
                {daysUntil(dsarCase.deadlineAt)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="text-sm"><span className="text-muted-foreground">Subject email:</span> {dsarCase.subjectEmail ?? "—"}</div>
          <div className="text-sm"><span className="text-muted-foreground">Subject phone:</span> {dsarCase.subjectPhone ?? "—"}</div>
          <div className="text-sm"><span className="text-muted-foreground">LinkedIn:</span> {dsarCase.subjectLinkedinUrl ?? "—"}</div>
          <div className="text-sm"><span className="text-muted-foreground">Name:</span> {dsarCase.subjectName ?? "—"}</div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {matchedIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No search executed yet. Click &quot;Run subject search&quot; to find matching records.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Matched on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchedContacts.map((c) => {
                  const matchedOn: string[] = [];
                  if (matchCriteria.email && c.email?.toLowerCase() === matchCriteria.email.toLowerCase()) matchedOn.push("email");
                  if (
                    matchCriteria.linkedin &&
                    c.person.linkedinUrl?.toLowerCase().includes(matchCriteria.linkedin.toLowerCase())
                  ) matchedOn.push("linkedinUrl");
                  if (matchCriteria.phone && (c.phone ?? c.person.primaryPhone)?.includes(matchCriteria.phone)) matchedOn.push("phone");
                  if (matchCriteria.name && c.person.fullName.toLowerCase().includes(matchCriteria.name.toLowerCase())) matchedOn.push("name");
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/admin/contacts/${c.id}`} className="underline-offset-4 hover:underline">
                          {c.person.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>
                        <Link href={`/admin/companies/${c.company.id}`} className="underline underline-offset-4 hover:underline">
                          {c.company.legalName}
                        </Link>
                      </TableCell>
                      <TableCell>{matchedOn.length ? matchedOn.join(", ") : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dsarCase.caseType === "erasure" ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Propagation status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>{dsarCase.tombstoneCreated ? "✓" : "⏳"} Tombstone table</div>
            <div>{dsarCase.aiTrainingDatasetNotified ? "✓" : "⏳"} AI training dataset</div>
            <div>{dsarCase.aiSdrPlatformNotified ? "✓" : "⏳"} AI SDR platform & active campaigns</div>
            <div>{dsarCase.subProcessorsNotified ? "✓" : "⏳"} Sub-processors</div>
            {allConfirmed ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
                All targets confirmed — case can now be closed
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <DsarCaseActions
            caseId={dsarCase.id}
            caseType={dsarCase.caseType}
            canClose={dsarCase.caseType !== "erasure" || allConfirmed}
            propagation={{
              tombstoneCreated: dsarCase.tombstoneCreated,
              aiTrainingDatasetNotified: dsarCase.aiTrainingDatasetNotified,
              aiSdrPlatformNotified: dsarCase.aiSdrPlatformNotified,
              subProcessorsNotified: dsarCase.subProcessorsNotified,
            }}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Action log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{fmtDateTime(a.createdAt)}</TableCell>
                  <TableCell>{a.actionType}</TableCell>
                  <TableCell>{actorById.get(a.actorUserId) ?? a.actorUserId}</TableCell>
                  <TableCell className="max-w-xl">
                    {a.metadata ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          {a.metadata.length > 120 ? `${a.metadata.slice(0, 120)}...` : a.metadata}
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap text-xs">{a.metadata}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
