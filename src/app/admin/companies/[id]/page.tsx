import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { getStatusVariant } from "@/lib/badge-helpers";

export const dynamic = "force-dynamic";

function relativeTime(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const take = 25;
  const skip = (page - 1) * take;

  const company = await db.company.findUnique({
    where: { id },
  });
  if (!company) notFound();

  const [parent, subsidiaries, aliases, totalContacts, contacts, enrichment, audit] =
    await Promise.all([
      company.parentCompanyId
        ? db.company.findUnique({
            where: { id: company.parentCompanyId },
            select: { id: true, legalName: true },
          })
        : null,
      db.company.findMany({
        where: { parentCompanyId: company.id },
        orderBy: { legalName: "asc" },
        select: { id: true, legalName: true },
      }),
      db.domainAlias.findMany({
        where: { companyId: company.id },
        orderBy: { aliasDomain: "asc" },
      }),
      db.contact.count({ where: { companyId: company.id, mergedIntoId: null } }),
      db.contact.findMany({
        where: { companyId: company.id, mergedIntoId: null },
        include: { person: { select: { fullName: true } }, client: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        skip,
        take,
      }),
      db.enrichmentLog.findMany({
        where: { companyId: company.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.auditLog.findMany({
        where: { resourceType: "company", resourceId: company.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

  const suppressionDomains = [company.rootDomain, ...aliases.map((a) => a.aliasDomain)];
  const suppressions = await db.suppression.findMany({
    where: { domain: { in: suppressionDomains } },
    orderBy: { createdAt: "desc" },
  });
  const totalPages = Math.max(1, Math.ceil(totalContacts / take));

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{company.legalName}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div><span className="text-muted-foreground">Root domain:</span> {company.rootDomain}</div>
          <div><span className="text-muted-foreground">Industry:</span> {company.industry ?? "—"}</div>
          <div><span className="text-muted-foreground">Country:</span> {company.country ?? "—"}</div>
          <div><span className="text-muted-foreground">Headcount band:</span> {company.headcountBand ?? "—"}</div>
          <div>
            <span className="text-muted-foreground">Parent:</span>{" "}
            {parent ? <Link className="underline underline-offset-4" href={`/admin/companies/${parent.id}`}>{parent.legalName}</Link> : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Subsidiaries:</span>{" "}
            {subsidiaries.length === 0
              ? "—"
              : subsidiaries.map((s, idx) => (
                  <span key={s.id}>
                    {idx > 0 ? ", " : ""}
                    <Link className="underline underline-offset-4" href={`/admin/companies/${s.id}`}>{s.legalName}</Link>
                  </span>
                ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Domain aliases</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Alias domain</TableHead><TableHead>Alias type</TableHead></TableRow></TableHeader>
            <TableBody>
              {aliases.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">No aliases.</TableCell></TableRow>
              ) : aliases.map((a) => (
                <TableRow key={a.id}><TableCell>{a.aliasDomain}</TableCell><TableCell>{a.aliasType}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Related contacts</CardTitle></CardHeader>
        <CardContent className="space-y-3 p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Gate</TableHead>
                <TableHead>Last verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No contacts for this company.</TableCell></TableRow>
              ) : contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link className="underline underline-offset-4" href={`/admin/contacts/${c.id}`}>{c.person.fullName}</Link></TableCell>
                  <TableCell>{c.client.name}</TableCell>
                  <TableCell><Badge className={getStatusVariant(c.gateStatus)}>{c.gateStatus}</Badge></TableCell>
                  <TableCell>{relativeTime(c.lastVerifiedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-6 pb-4 text-sm">
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Link className={`rounded border px-3 py-1 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`} href={`?page=${Math.max(1, page - 1)}`}>Previous</Link>
              <Link className={`rounded border px-3 py-1 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`} href={`?page=${Math.min(totalPages, page + 1)}`}>Next</Link>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Suppression status</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Scope</TableHead><TableHead>Domain</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {suppressions.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No domain suppressions.</TableCell></TableRow>
              ) : suppressions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.scope}</TableCell>
                  <TableCell>{s.domain ?? "—"}</TableCell>
                  <TableCell>{s.reasonCode}</TableCell>
                  <TableCell><Badge className={getStatusVariant(s.releaseStatus)}>{s.releaseStatus}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Enrichment history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Credits</TableHead></TableRow></TableHeader>
            <TableBody>
              {enrichment.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No enrichment history.</TableCell></TableRow>
              ) : enrichment.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{relativeTime(e.createdAt)}</TableCell>
                  <TableCell>{e.provider}</TableCell>
                  <TableCell><Badge className={getStatusVariant(e.status)}>{e.status}</Badge></TableCell>
                  <TableCell>{e.confidence == null ? "—" : `${Math.round(e.confidence * 100)}%`}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.creditsUsed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead className="text-right">Records</TableHead></TableRow></TableHeader>
            <TableBody>
              {audit.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No company audit events.</TableCell></TableRow>
              ) : audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{relativeTime(a.createdAt)}</TableCell>
                  <TableCell>{a.action}</TableCell>
                  <TableCell>{a.actorUserId ?? "system"}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.recordsAffected}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
