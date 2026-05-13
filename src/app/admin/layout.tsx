import { AppShell } from "@/components/AppShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell title="Admin">{children}</AppShell>;
}
