import { SectionFrame } from "@/components/shell/section-tabs";
import { SETTINGS_TABS } from "@/lib/roles";
import { requireSection } from "@/lib/session";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const me = await requireSection("settings");
  const tabs = SETTINGS_TABS.filter((t) => t.roles.includes(me.role)).map(({ key, label, href }) => ({ key, label, href }));
  return <SectionFrame title="Settings" tabs={tabs}>{children}</SectionFrame>;
}
