"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
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
  Upload,
  User,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 flex-col justify-center border-b border-slate-200 px-4">
        <span className="text-lg font-semibold tracking-tight">Brightvision</span>
        <span className="text-xs text-slate-500">Master Database</span>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
        <div className="flex flex-col gap-1">
          <Link
            href="/admin"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isDashboard)}`}
          >
            <LayoutDashboard size={16} aria-hidden />
            Dashboard
          </Link>
          <Link
            href="/admin/health"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isHealth)}`}
          >
            <Activity size={16} aria-hidden />
            Database health
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Data pipeline
          </p>
          <Link
            href="/admin/intake/upload"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isUpload)}`}
          >
            <Upload size={16} aria-hidden />
            Upload CSV
          </Link>
          <Link
            href="/admin/intake/batches"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isBatches)}`}
          >
            <Layers size={16} aria-hidden />
            Import batches
          </Link>
          <Link
            href="/admin/dedup"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isDedup)}`}
          >
            <GitMerge size={16} aria-hidden />
            Duplicate review
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Module 3 — Verify & Enrich
          </p>
          <Link
            href="/admin/conflicts"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isConflicts)}`}
          >
            <AlertTriangle size={16} aria-hidden />
            Resolve conflicts
          </Link>
          <Link
            href="/admin/enrichment-waterfall"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isEnrichmentWaterfall)}`}
          >
            <Workflow size={16} aria-hidden />
            Enrichment waterfall
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Module 5 — AI SDR Integration
          </p>
          <Link
            href="/admin/platform-sim"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isPlatformSim)}`}
          >
            <Radio size={16} aria-hidden />
            Platform simulator
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Module 6 — Reporting
          </p>
          <Link
            href="/admin/analytics"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isAnalytics)}`}
          >
            <BarChart3 size={16} aria-hidden />
            Analytics
          </Link>
          <Link
            href="/admin/bias-monitoring"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isBiasMonitoring)}`}
          >
            <Scale size={16} aria-hidden />
            Bias monitoring
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Module 4 — Governance
          </p>
          <Link
            href="/admin/suppressions"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isSuppressions)}`}
          >
            <Shield size={16} aria-hidden />
            Suppressions
          </Link>
          <Link
            href="/admin/quarantine"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isQuarantine)}`}
          >
            <Lock size={16} aria-hidden />
            Quarantine
          </Link>
          <Link
            href="/admin/accuracy"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isAccuracy)}`}
          >
            <BarChart3 size={16} aria-hidden />
            Accuracy QA
          </Link>
          <Link
            href="/admin/refresh-cycle"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isRefreshCycle)}`}
          >
            <RotateCw size={16} aria-hidden />
            Refresh cycle
          </Link>
          <Link
            href="/admin/dsar"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isDsar)}`}
          >
            <FileSearch size={16} aria-hidden />
            DSAR cases
          </Link>
          <Link
            href="/admin/bulk-approvals"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isBulkApprovals)}`}
          >
            <Gavel size={16} aria-hidden />
            Bulk approvals
          </Link>
          <Link
            href="/admin/rollback"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isRollback)}`}
          >
            <RotateCw size={16} aria-hidden />
            Rollback
          </Link>
          <Link
            href="/admin/audit-log"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isAuditLog)}`}
          >
            <History size={16} aria-hidden />
            Audit log
          </Link>
        </div>

        <div className="flex flex-col gap-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Reference
          </p>
          <Link
            href="/admin/data-dictionary"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${navLinkClass(isDataDictionary)}`}
          >
            <BookOpen size={16} aria-hidden />
            Data dictionary
          </Link>
        </div>
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
