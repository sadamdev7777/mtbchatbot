import { AppShell } from "@/components/shell/app-shell";
import { getMe } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return <AppShell me={me}>{children}</AppShell>;
}
