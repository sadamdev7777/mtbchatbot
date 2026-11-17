import { SectionFrame } from "@/components/shell/section-tabs";
import { requireSection } from "@/lib/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireSection("broadcast");
  return <SectionFrame title="Broadcast" description="Send approved templates to opted-in contacts." tabs={[{ key: "broadcast", label: "Broadcast", href: "/broadcast" }, { key: "templates", label: "Templates", href: "/broadcast/templates" }]}>{children}</SectionFrame>;
}
