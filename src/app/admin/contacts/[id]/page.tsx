import { Archive, Building2, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { getStatusVariant } from "@/lib/badge-helpers";
import { cn } from "@/lib/utils";
import ConflictCard, { type ConflictCardProps } from "./ConflictCard";
import HardDeleteButton from "./HardDeleteButton";

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
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function parseFieldsFilled(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
    return [];
  } catch {
    return [];
  }
}

function humanizeLawfulBasis(v: string | null): string {
  if (!v) return "Not set";
  if (v === "legitimate_interest") return "Legitimate interest";
  if (v === "consent") return "Consent";
  if (v === "contract") return "Contract";
  if (v === "legal_obligation") return "Legal obligation";
  return v;
}

function humanizePurpose(v: string | null): string {
  if (!v) return "Not set";
  if (v === "b2b_prospecting") return "B2B prospecting";
  if (v === "campaign_execution") return "Campaign execution";
  if (v === "analytics") return "Analytics";
  return v;
}

function humanizeMarket(v: string | null): string {
  if (!v) return "Not set";
  if (v === "uk_nordics") return "UK & Nordics";
  if (v === "north_america") return "North America";
  if (v === "dach") return "DACH";
  if (v === "benelux") return "Benelux";
  return "Other";
}

function humanizeRetention(v: string | null): string {
  if (!v) return "Not set";
  if (v === "approaching_review") return "Approaching review";
  if (v === "anonymisation_queued") return "Anonymisation queued";
  if (v === "anonymised") return "Anonymised";
  return "Active";
}

function badgeForLiaStatus(v: string | null): string {
  if (v === "documented") return "border-transparent bg-emerald-100 text-emerald-800";
  if (v === "pending_review") return "border-transparent bg-amber-100 text-amber-800";
  if (v === "expired") return "border-transparent bg-rose-100 text-rose-800";
  return "border-transparent bg-slate-100 text-slate-700";
}

function badgeForSensitivity(v: string | null): string {
  if (v === "public") return "border-transparent bg-emerald-100 text-emerald-800";
  if (v === "business_contact") return "border-transparent bg-slate-100 text-slate-700";
  if (v === "personal") return "border-transparent bg-amber-100 text-amber-800";
  return "border-transparent bg-slate-100 text-slate-700";
}

function badgeForRetention(v: string | null): string {
  if (v === "active") return "border-transparent bg-emerald-100 text-emerald-800";
  if (v === "approaching_review") return "border-transparent bg-amber-100 text-amber-800";
  if (v === "anonymisation_queued") return "border-transparent bg-rose-100 text-rose-800";
  if (v === "anonymised") return "border-transparent bg-slate-100 text-slate-700";
  return "border-transparent bg-slate-100 text-slate-700";
}

type ConflictRaw = {
  field: string;
  primary: { provider: string; value: string | null; confidence: number };
  secondary: { provider: string; value: string | null; confidence: number };
  delta: number;
};

function conflictToCardProps(
  enrichmentLogId: string,
  raw: string,
): ConflictCardProps | null {
  let parsed: ConflictRaw;
  try {
    parsed = JSON.parse(raw) as ConflictRaw;
  } catch {
    return null;
  }
  if (
    !parsed?.field ||
    !parsed.primary ||
    !parsed.secondary ||
    typeof parsed.primary.provider !== "string" ||
    typeof parsed.secondary.provider !== "string"
  ) {
    return null;
  }
  const sides = [parsed.primary, parsed.secondary];
  const cognism = sides.find((s) => s.provider === "cognism");
  const apollo = sides.find((s) => s.provider === "apollo");
  if (!cognism || !apollo) return null;
  return {
    enrichmentLogId,
    field: parsed.field,
    cognism: { value: cognism.value, confidence: cognism.confidence },
    apollo: { value: apollo.value, confidence: apollo.confidence },
    delta: parsed.delta ?? Math.abs(cognism.confidence - apollo.confidence),
  };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      person: true,
      company: true,
    },
  });
  if (!contact) notFound();

  const [verifications, enrichmentLogs, gateHistory, survivor, otherRoles, activeCampaignRoles] = await Promise.all([
    db.verification.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.enrichmentLog.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.gateStatusHistory.findMany({
      where: { contactId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    contact.mergedIntoId
      ? db.contact.findUnique({
          where: { id: contact.mergedIntoId },
          include: { person: { select: { fullName: true } } },
        })
      : null,
    db.contact.findMany({
      where: {
        personId: contact.personId,
        id: { not: contact.id },
        mergedIntoId: null,
      },
      include: {
        company: { select: { id: true, legalName: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.contact.findMany({
      where: {
        personId: contact.personId,
        campaignActive: true,
        mergedIntoId: null,
      },
      include: {
        company: { select: { id: true, legalName: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: [{ clientId: "asc" }, { updatedAt: "desc" }],
      take: 100,
    }),
  ]);

  const pendingConflicts = enrichmentLogs.filter((r) => r.status === "conflict_pending");
  const pendingCards = pendingConflicts
    .map((r) =>
      r.rawResponse ? conflictToCardProps(r.id, r.rawResponse) : null,
    )
    .filter((p): p is ConflictCardProps => p !== null);

  const subtitleParts = [
    contact.email ?? "—",
    contact.title ?? "—",
    contact.company?.legalName ? `at ${contact.company.legalName}` : null,
  ].filter(Boolean);

  const trackedFields = [
    { key: "title", label: "Title", value: contact.title ?? "—" },
    { key: "seniority", label: "Seniority", value: contact.seniority ?? "—" },
    { key: "phone", label: "Phone", value: contact.phone ?? "—" },
    { key: "industry", label: "Industry", value: contact.company?.industry ?? "—" },
    { key: "country", label: "Country", value: contact.company?.country ?? "—" },
    { key: "headcountBand", label: "Headcount band", value: contact.company?.headcountBand ?? "—" },
  ] as const;

  const latestProviderByField = new Map<
    string,
    { provider: string; createdAt: Date }
  >();
  for (const row of enrichmentLogs) {
    if (row.provider === "conflict_detector") continue;
    const fields = parseFieldsFilled(row.fieldsFilled);
    for (const field of fields) {
      if (!latestProviderByField.has(field)) {
        latestProviderByField.set(field, { provider: row.provider, createdAt: row.createdAt });
      }
    }
  }
  const crossClientActive = activeCampaignRoles.filter((r) => r.clientId !== contact.clientId);

  return (
    <div className="space-y-6">
      {survivor ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <Archive className="size-4" />
          <AlertTitle>Soft-archived</AlertTitle>
          <AlertDescription>
            Merged into{" "}
            <Link
              href={`/admin/contacts/${survivor.id}`}
              className="font-medium underline underline-offset-4"
            >
              {survivor.person.fullName}
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {contact.quarantineReason ? (
        <Alert
          variant="destructive"
          className="border-rose-200 bg-rose-50 text-rose-900 [&>svg]:text-rose-700"
        >
          <Lock className="size-4" />
          <AlertTitle>Quarantined</AlertTitle>
          <AlertDescription>
            This contact is quarantined:{" "}
            <span className="font-medium">{contact.quarantineReason}</span>.{" "}
            <Link
              href={`/admin/quarantine?clientId=${contact.clientId}`}
              className="font-medium underline underline-offset-4"
            >
              Review in quarantine queue →
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {contact.person.fullName}
            </CardTitle>
            <p className="text-sm text-slate-600">{subtitleParts.join(" · ")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={getStatusVariant(contact.gateStatus)}>
              {contact.gateStatus}
            </Badge>
            {contact.campaignActive ? (
              <Badge className="border-transparent bg-blue-100 text-blue-800">
                Campaign active
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Identity
              </h3>
              <dl className="space-y-2">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Email</dt>
                  <dd className="break-all">{contact.email ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Phone</dt>
                  <dd>{contact.phone ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">LinkedIn</dt>
                  <dd className="break-all">
                    {contact.person.linkedinUrl ? (
                      <a
                        href={
                          contact.person.linkedinUrl.startsWith("http")
                            ? contact.person.linkedinUrl
                            : `https://${contact.person.linkedinUrl}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {contact.person.linkedinUrl}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Seniority</dt>
                  <dd>{contact.seniority ?? "—"}</dd>
                </div>
              </dl>
            </div>
            <div className="space-y-3 text-sm">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Building2 className="size-3.5" aria-hidden />
                Company
              </h3>
              <dl className="space-y-2">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Name</dt>
                  <dd className="font-medium">
                    {contact.company ? (
                      <Link
                        href={`/admin/companies/${contact.company.id}`}
                        className="underline underline-offset-4 hover:underline"
                      >
                        {contact.company.legalName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Country</dt>
                  <dd>{contact.company?.country ?? "—"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Domain</dt>
                  <dd className="font-mono text-xs">
                    {contact.company?.rootDomain ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
            <span>
              Last verified:{" "}
              <span className="font-medium text-foreground">
                {relativeTime(contact.lastVerifiedAt)}
              </span>
            </span>
            <span>
              Last enriched:{" "}
              <span className="font-medium text-foreground">
                {relativeTime(contact.lastEnrichedAt)}
              </span>
            </span>
            <span>
              Write source:{" "}
              <span className="font-medium text-foreground">
                {contact.writeSource ?? "—"}
              </span>
            </span>
            <span>
              Lifecycle:{" "}
              <span className="font-medium text-foreground">
                {contact.lifecycleStage}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Lawful basis &amp; retention</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Lawful basis</p>
            <p className={contact.lawfulBasis ? "" : "text-muted-foreground"}>{humanizeLawfulBasis(contact.lawfulBasis)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Processing purpose</p>
            <p className={contact.processingPurpose ? "" : "text-muted-foreground"}>{humanizePurpose(contact.processingPurpose)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">LIA status</p>
            {contact.liaStatus ? (
              <Badge className={badgeForLiaStatus(contact.liaStatus)}>
                {contact.liaStatus === "documented"
                  ? "Documented"
                  : contact.liaStatus === "pending_review"
                    ? "Pending review"
                    : "Expired"}
              </Badge>
            ) : (
              <p className="text-muted-foreground">Not set</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">LIA completed</p>
            <p className={contact.liaCompletedAt ? "" : "text-muted-foreground"}>
              {contact.liaCompletedAt ? relativeTime(contact.liaCompletedAt) : "Not set"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Market</p>
            <p className={contact.market ? "" : "text-muted-foreground"}>{humanizeMarket(contact.market)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sensitivity tier</p>
            {contact.sensitivityTier ? (
              <Badge className={badgeForSensitivity(contact.sensitivityTier)}>
                {contact.sensitivityTier === "business_contact"
                  ? "Business contact"
                  : contact.sensitivityTier === "personal"
                    ? "Personal"
                    : "Public"}
              </Badge>
            ) : (
              <p className="text-muted-foreground">Not set</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Retention status</p>
            {contact.retentionStatus ? (
              <Badge className={badgeForRetention(contact.retentionStatus)}>
                {humanizeRetention(contact.retentionStatus)}
              </Badge>
            ) : (
              <p className="text-muted-foreground">Not set</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Retention review due</p>
            <p className={contact.retentionReviewDueAt ? "" : "text-muted-foreground"}>
              {contact.retentionReviewDueAt ? relativeTime(contact.retentionReviewDueAt) : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Source provenance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field name</TableHead>
                <TableHead>Current value</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Last verified</TableHead>
                <TableHead>Last enriched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trackedFields.map((field) => {
                const provider = latestProviderByField.get(field.key);
                return (
                  <TableRow key={field.key}>
                    <TableCell>{field.label}</TableCell>
                    <TableCell>{field.value}</TableCell>
                    <TableCell>{provider?.provider ?? "—"}</TableCell>
                    <TableCell>{relativeTime(contact.lastVerifiedAt)}</TableCell>
                    <TableCell>{provider ? relativeTime(provider.createdAt) : relativeTime(contact.lastEnrichedAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Other roles for this person</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Gate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {otherRoles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    This person has no other recorded roles.
                  </TableCell>
                </TableRow>
              ) : (
                otherRoles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <Link href={`/admin/contacts/${role.id}`} className="underline underline-offset-4 hover:underline">
                        {role.email ?? role.id.slice(-8)}
                      </Link>
                    </TableCell>
                    <TableCell>{role.client.name}</TableCell>
                    <TableCell>
                      <Link href={`/admin/companies/${role.company.id}`} className="underline underline-offset-4 hover:underline">
                        {role.company.legalName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusVariant(role.gateStatus)}>{role.gateStatus}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Cross-client campaign status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {crossClientActive.length > 0 ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>Cross-client contention</AlertTitle>
              <AlertDescription>
                ⚠ This person is in {crossClientActive.length} active campaign(s) in other client workspaces. AI SDR enforces contention locks; the database shows the state.
              </AlertDescription>
            </Alert>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Company</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeCampaignRoles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                    No active campaigns for this person.
                  </TableCell>
                </TableRow>
              ) : (
                activeCampaignRoles.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.client.name}</TableCell>
                    <TableCell>
                      <Link href={`/admin/companies/${row.company.id}`} className="underline underline-offset-4 hover:underline">
                        {row.company.legalName}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pendingCards.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            Pending conflicts{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({pendingCards.length})
            </span>
          </h2>
          <p className="text-sm text-slate-600">
            Provider responses disagreed and the confidence delta fell under 15%. Pick a
            survivor and record a reason; the resolution writes to audit_log.
          </p>
          <div className="space-y-4 pt-2">
            {pendingCards.map((card) => (
              <ConflictCard key={card.enrichmentLogId} {...card} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Verification history{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({verifications.length})
          </span>
        </h2>
        <p className="text-sm text-slate-600">Email and phone verification events.</p>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No verifications yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  verifications.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {relativeTime(v.createdAt)}
                      </TableCell>
                      <TableCell>{v.verificationType}</TableCell>
                      <TableCell className="font-mono text-xs">{v.provider}</TableCell>
                      <TableCell>
                        <Badge className={getStatusVariant(v.status)}>{v.status}</Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {v.confidence !== null
                          ? `${(v.confidence * 100).toFixed(0)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {v.creditsUsed}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Enrichment history{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({enrichmentLogs.length})
          </span>
        </h2>
        <p className="text-sm text-slate-600">Waterfall enrichment attempts per provider.</p>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="w-12">Step</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Fields filled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrichmentLogs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No enrichment runs yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  enrichmentLogs.map((e) => {
                    const fields = parseFieldsFilled(e.fieldsFilled);
                    return (
                      <TableRow key={e.id} className="align-top">
                        <TableCell className="tabular-nums text-muted-foreground">
                          {relativeTime(e.createdAt)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.provider}</TableCell>
                        <TableCell className="tabular-nums">{e.step}</TableCell>
                        <TableCell>
                          <Badge className={getStatusVariant(e.status)}>{e.status}</Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {e.confidence !== null
                            ? `${(e.confidence * 100).toFixed(0)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {e.creditsUsed}
                        </TableCell>
                        <TableCell>
                          {fields.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {fields.map((f) => (
                                <Badge
                                  key={f}
                                  variant="outline"
                                  className="font-mono text-[10px]"
                                >
                                  {f}
                                </Badge>
                              ))}
                            </div>
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
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          Gate status history{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({gateHistory.length})
          </span>
        </h2>
        <p className="text-sm text-slate-600">Lifecycle transitions and actors.</p>
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Transition</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateHistory.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No gate transitions recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  gateHistory.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {relativeTime(h.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                          <span className="text-muted-foreground">
                            {h.fromGate ?? "—"}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <Badge className={getStatusVariant(h.toGate)}>{h.toGate}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>{h.reason}</TableCell>
                      <TableCell className="font-mono text-xs">{h.actor}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {!contact.mergedIntoId ? (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-rose-900">Danger zone</h2>
          <p className="text-sm text-slate-600">
            Irreversible GDPR Article 17 hard delete — tombstones retained, audit logs kept.
          </p>
          <Card className={cn("border-rose-300 shadow-sm", "bg-card")}>
            <CardHeader>
              <CardTitle className="text-lg text-rose-900">Hard delete (GDPR Article 17)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-rose-900/90">
              <p>
                Permanently remove this contact and its identifying data. Hashed identifiers will
                be preserved in the tombstones table to prevent re-import. Event logs
                (verifications, enrichments, gates) are retained for audit purposes. This action
                cannot be undone.
              </p>
              <HardDeleteButton />
            </CardContent>
          </Card>
        </section>
      ) : null}

      <Button variant="link" asChild className="h-auto px-0">
        <Link href="/admin/intake/batches">← Back to all batches</Link>
      </Button>
    </div>
  );
}
