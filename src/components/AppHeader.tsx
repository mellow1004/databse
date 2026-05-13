"use client";

import { usePathname } from "next/navigation";

function titleForPath(pathname: string | null, fallback: string): string {
  if (!pathname) return fallback;
  if (pathname === "/admin" || pathname === "/admin/") {
    return "Welcome back, Olivia";
  }
  if (pathname.startsWith("/admin/health")) return "Database health";
  if (pathname.startsWith("/admin/intake/upload")) return "Upload CSV";
  if (pathname.startsWith("/admin/intake/batches")) return "Import batches";
  if (pathname.startsWith("/admin/dedup")) return "Duplicate review";
  if (pathname.startsWith("/admin/conflicts")) return "Resolve conflicts";
  if (pathname.startsWith("/admin/suppressions")) return "Suppressions";
  if (pathname.startsWith("/admin/quarantine")) return "Quarantine";
  if (pathname.startsWith("/admin/accuracy")) return "Accuracy QA";
  if (pathname.startsWith("/admin/contacts/")) return "Contact";
  return fallback;
}

export function AppHeader({ title }: { title: string }) {
  const pathname = usePathname();
  const heading = titleForPath(pathname, title);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <p className="text-lg font-semibold">{heading}</p>
      <div
        className="flex size-8 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700"
        aria-label="Olivia Lindberg"
      >
        OL
      </div>
    </header>
  );
}
