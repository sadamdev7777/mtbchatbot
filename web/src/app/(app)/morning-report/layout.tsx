import { SectionFrame } from "@/components/shell/section-tabs";
import { requireSection } from "@/lib/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSection("morning");
  return <SectionFrame title="Morning report" description="What the night job found, changed and suggests." tabs={[{ key: "report", label: "Report", href: "/morning-report" }, { key: "night", label: "Night job", href: "/morning-report/night-job" }]}>{children}</SectionFrame>;
}
