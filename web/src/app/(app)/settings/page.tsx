import { redirect } from "next/navigation";
import { SETTINGS_TABS } from "@/lib/roles";
import { getMe } from "@/lib/session";

export default async function SettingsIndex() {
  const me = await getMe();
  redirect(SETTINGS_TABS.find((t) => t.roles.includes(me.role))!.href);
}
