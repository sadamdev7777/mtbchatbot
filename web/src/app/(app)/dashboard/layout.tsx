import { SectionFrame } from "@/components/shell/section-tabs";
import { requireSection } from "@/lib/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSection("dashboard");
  return <SectionFrame title="Dashboard" tabs={[{ key: "overview", label: "Overview", href: "/dashboard" }, { key: "reports", label: "Full report", href: "/dashboard/reports" }]}>{children}</SectionFrame>;
}
