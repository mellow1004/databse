"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  FileSearch,
  Gavel,
  History,
  GitMerge,
  LayoutDashboard,
  Layers,
  Lock,
  Radio,
  RotateCw,
  Scale,
  Shield,
  BookOpen,
  Workflow,
  Network,
  Upload,
  User,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function navLinkClass(active: boolean) {
  return active
    ? "bg-slate-100 text-slate-900 font-medium"
    : "text-slate-600 hover:bg-slate-100/60";
}

export function AppSidebar() {
  const pathname = usePathname();

  const isDashboard = pathname === "/admin" || pathname === "/admin/";
  const isHealth = pathname.startsWith("/admin/health");
  const isUpload = pathname.startsWith("/admin/intake/upload");
  const isBatches = pathname.startsWith("/admin/intake/batches");
  const isDedup = pathname.startsWith("/admin/dedup");
  const isConflicts = pathname.startsWith("/admin/conflicts");
  const isSuppressions = pathname.startsWith("/admin/suppressions");
  const isQuarantine = pathname.startsWith("/admin/quarantine");
  const isAccuracy = pathname.startsWith("/admin/accuracy");
  const isPlatformSim = pathname.startsWith("/admin/platform-sim");
  const isAnalytics = pathname.startsWith("/admin/analytics");
  const isBiasMonitoring = pathname.startsWith("/admin/bias-monitoring");
  const isRefreshCycle = pathname.startsWith("/admin/refresh-cycle");
  const isDemoControls = pathname.startsWith("/admin/demo-controls");
  const isDsar = pathname.startsWith("/admin/dsar");
  const isBulkApprovals = pathname.startsWith("/admin/bulk-approvals");
  const isAuditLog = pathname.startsWith("/admin/audit-log");
  const isRollback = pathname.startsWith("/admin/rollback");
  const isDataDictionary = pathname.startsWith("/admin/data-dictionary");
  const isEnrichmentWaterfall = pathname.startsWith("/admin/enrichment-waterfall");
  const isProviderGovernance = pathname.startsWith("/admin/provider-governance");

  const sections = useMemo(
    () => [
      {
        label: "Overview",
        collapsible: false,
        links: [
          { href: "/admin", label: "Dashboard", icon: LayoutDashboard, active: isDashboard },
          { href: "/admin/health", label: "Database health", icon: Activity, active: isHealth },
        ],
      },
      {
        label: "Data pipeline",
        collapsible: true,
        links: [
          { href: "/admin/intake/upload", label: "Upload CSV", icon: Upload, active: isUpload },
          { href: "/admin/intake/batches", label: "Import batches", icon: Layers, active: isBatches },
          { href: "/admin/dedup", label: "Duplicate review", icon: GitMerge, active: isDedup },
        ],
      },
      {
        label: "Module 3 — Verify & Enrich",
        collapsible: true,
        links: [
          { href: "/admin/conflicts", label: "Resolve conflicts", icon: AlertTriangle, active: isConflicts },
          {
            href: "/admin/enrichment-waterfall",
            label: "Enrichment waterfall",
            icon: Workflow,
            active: isEnrichmentWaterfall,
          },
        ],
      },
      {
        label: "Module 5 — AI SDR Integration",
        collapsible: true,
        links: [
          { href: "/admin/platform-sim", label: "Platform simulator", icon: Radio, active: isPlatformSim },
        ],
      },
      {
        label: "Module 6 — Reporting",
        collapsible: true,
        links: [
          { href: "/admin/analytics", label: "Analytics", icon: BarChart3, active: isAnalytics },
          { href: "/admin/bias-monitoring", label: "Bias monitoring", icon: Scale, active: isBiasMonitoring },
          {
            href: "/admin/provider-governance",
            label: "Provider governance",
            icon: Network,
            active: isProviderGovernance,
          },
        ],
      },
      {
        label: "Module 4 — Governance",
        collapsible: true,
        links: [
          { href: "/admin/suppressions", label: "Suppressions", icon: Shield, active: isSuppressions },
          { href: "/admin/quarantine", label: "Quarantine", icon: Lock, active: isQuarantine },
          { href: "/admin/accuracy", label: "Accuracy QA", icon: BarChart3, active: isAccuracy },
          { href: "/admin/refresh-cycle", label: "Refresh cycle", icon: RotateCw, active: isRefreshCycle },
          { href: "/admin/dsar", label: "DSAR cases", icon: FileSearch, active: isDsar },
          { href: "/admin/bulk-approvals", label: "Bulk approvals", icon: Gavel, active: isBulkApprovals },
          { href: "/admin/rollback", label: "Rollback", icon: RotateCw, active: isRollback },
          { href: "/admin/audit-log", label: "Audit log", icon: History, active: isAuditLog },
        ],
      },
      {
        label: "Reference",
        collapsible: true,
        links: [
          { href: "/admin/data-dictionary", label: "Data dictionary", icon: BookOpen, active: isDataDictionary },
        ],
      },
    ],
    [
      isAccuracy,
      isAnalytics,
      isAuditLog,
      isBatches,
      isBiasMonitoring,
      isBulkApprovals,
      isConflicts,
      isDashboard,
      isDataDictionary,
      isDsar,
      isEnrichmentWaterfall,
      isHealth,
      isPlatformSim,
      isProviderGovernance,
      isQuarantine,
      isRefreshCycle,
      isRollback,
      isSuppressions,
      isUpload,
    ],
  );

  const [openBySection, setOpenBySection] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const section of sections) {
      if (!section.collapsible) continue;
      const key = `sidebar-section:${section.label}`;
      const stored = window.localStorage.getItem(key);
      if (stored === "true" || stored === "false") {
        initial[section.label] = stored === "true";
      } else {
        initial[section.label] = section.links.some((link) => link.active);
      }
    }
    setOpenBySection(initial);
  }, [sections]);

  function setSectionOpen(label: string, next: boolean) {
    setOpenBySection((prev) => ({ ...prev, [label]: next }));
    window.localStorage.setItem(`sidebar-section:${label}`, String(next));
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 flex-col justify-center border-b border-slate-200 px-4">
        <span className="text-lg font-semibold tracking-tight">Brightvision</span>
        <span className="text-xs text-slate-500">Master Database</span>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {sections.map((section) =>
          section.collapsible ? (
            <Collapsible
              key={section.label}
              open={openBySection[section.label] ?? false}
              onOpenChange={(next) => setSectionOpen(section.label, next)}
              className="flex flex-col gap-1"
            >
              <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section.label}
                <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-1">
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(link.active)}`}
                  >
                    <link.icon size={16} aria-hidden />
                    {link.label}
                  </Link>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <div key={section.label} className="flex flex-col gap-1">
              {section.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(link.active)}`}
                >
                  <link.icon size={16} aria-hidden />
                  {link.label}
                </Link>
              ))}
            </div>
          ),
        )}
      </nav>

      <div className="mt-auto border-t border-slate-200 px-3 py-4">
        <Link
          href="/admin/demo-controls"
          className={`mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
            isDemoControls
              ? "border-amber-300 bg-amber-100 text-amber-900"
              : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          }`}
        >
          <Wand2 size={14} aria-hidden />
          Demo controls
        </Link>
        <p className="px-1 text-xs text-slate-400">Brightvision GTME Ops · v0.1 (Demo)</p>
        <div className="mt-3 flex items-center gap-2 px-1 text-xs text-slate-600">
          <User size={14} className="shrink-0 text-slate-400" aria-hidden />
          <span>Olivia Lindberg · Data Owner</span>
        </div>
      </div>
    </aside>
  );
}
