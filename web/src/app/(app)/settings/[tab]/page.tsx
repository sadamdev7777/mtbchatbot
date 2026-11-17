import { notFound, redirect } from "next/navigation";
import { ActivityLog } from "@/components/settings/activity";
import { AutomationSettings } from "@/components/settings/automation";
import { ChannelSettings } from "@/components/settings/channel";
import { IntegrationSettings } from "@/components/settings/integrations";
import { LabelSettings } from "@/components/settings/labels";
import { NotificationSettings } from "@/components/settings/notifications";
import { StaffSettings } from "@/components/settings/staff";
import { SETTINGS_TABS } from "@/lib/roles";
import { getMe } from "@/lib/session";

const VIEWS: Record<string, React.ComponentType> = {
  staff: StaffSettings, labels: LabelSettings, channel: ChannelSettings, integrations: IntegrationSettings,
  automation: AutomationSettings, notifications: NotificationSettings, activity: ActivityLog,
};

export default async function SettingsTab({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const me = await getMe();
  const View = VIEWS[tab];
  if (!View) notFound();
  const allowed = tab === "activity" ? ["owner", "admin"].includes(me.role) : SETTINGS_TABS.find((t) => t.key === tab)?.roles.includes(me.role);
  if (!allowed) redirect("/settings/notifications");
  return <View />;
}
