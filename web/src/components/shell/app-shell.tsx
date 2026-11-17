"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/misc";
import { MeProvider } from "@/components/shell/me-context";
import { NotificationCenter } from "@/components/shell/notification-center";
import { NotificationsProvider, useNotifications } from "@/components/shell/notifications-provider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { navFor, ROLE_LABEL, type Me } from "@/lib/roles";
import { cn } from "@/lib/utils";

function useBadges(me: Me) {
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    const sb = supabaseBrowser();
    let alive = true;
    async function load() {
      const out: Record<string, number> = {};
      if (me.role !== "accounts") {
        const { count } = await sb.from("conversations").select("id", { count: "exact", head: true }).eq("needs_staff", true).neq("status", "closed");
        out.inbox = count ?? 0;
      }
      if (me.role === "owner" || me.role === "admin" || me.role === "team_lead") {
        const { count } = await sb.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");
        out.morning = count ?? 0;
      }
      if (me.role === "owner" || me.role === "accounts" || me.role === "admin") {
        const { count } = await sb.from("payment_verifications").select("id", { count: "exact", head: true }).eq("status", "pending");
        out.payments = count ?? 0;
      }
      if (alive) setBadges(out);
    }
    load();
    const ch = sb.channel("badges")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_verifications" }, load)
      .subscribe();
    const t = setInterval(() => sb.rpc("rpc_touch_presence"), 60_000);
    sb.rpc("rpc_touch_presence");
    return () => { alive = false; clearInterval(t); sb.removeChannel(ch); };
  }, [me.role]);
  return badges;
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const badges = useBadges(me);
  const items = navFor(me.role);
  const active = items.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"))?.key;

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  const mobileNav = [
    { key: "inbox", label: "Inbox", href: "/inbox" },
    { key: "contacts", label: "Contacts", href: "/contacts" },
    { key: "dashboard", label: "Dashboard", href: "/dashboard" },
    { key: "notifications", label: "Notifications", href: "/notifications" },
  ].filter((i) => me.role !== "accounts" || i.key === "notifications");

  return (
    <MeProvider me={me}>
      <NotificationsProvider>
      <div className="flex min-h-dvh">
        <nav aria-label="Main menu" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-0.5 overflow-y-auto bg-sidebar px-3 py-5 text-sidebar-text md:flex">
          <div className="flex items-center gap-2.5 px-2 pb-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-whatsapp">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2B26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.9A8 8 0 1 1 21 12z" /></svg>
            </div>
            <div>
              <div className="text-[15px] font-bold text-white">MTB Inbox</div>
              <div className="text-xs text-sidebar-muted">{me.company_name.replace(" Sdn Bhd", "")}</div>
            </div>
          </div>
          {items.map((it) => (
            <div key={it.key}>
              {it.header ? <div className="px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-header">{it.header}</div> : null}
              <Link
                href={it.href}
                aria-current={active === it.key ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center justify-between rounded-lg px-3 text-sm no-underline",
                  active === it.key ? "bg-sidebar-active font-semibold text-white hover:text-white" : "font-medium text-sidebar-text hover:bg-sidebar-card hover:text-white",
                )}
              >
                <span>{it.label}</span>
                {badges[it.key] ? (
                  <span className={cn("flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-xs font-bold",
                    it.key === "inbox" ? "bg-whatsapp text-sidebar" : "bg-orange text-[#1D1302]")}>{badges[it.key]}</span>
                ) : null}
              </Link>
            </div>
          ))}
          <div className="mt-auto pt-5">
            <div className="mb-2 px-1"><NotificationCenter dark /></div>
            <div className="flex items-center gap-2.5 rounded-[10px] bg-sidebar-card p-2.5">
              <Avatar name={me.display_name} light />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{me.display_name}</div>
                <div className="text-xs text-sidebar-muted">{ROLE_LABEL[me.role]} · Online</div>
              </div>
              <button type="button" onClick={logout} aria-label="Log out" className="flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-text hover:bg-sidebar-active">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
              </button>
            </div>
          </div>
        </nav>
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
        <nav aria-label="Mobile menu" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white md:hidden">
          {mobileNav.map((it) => {
            const on = pathname.startsWith(it.href);
            return (
              <Link key={it.key} href={it.href} aria-current={on ? "page" : undefined}
                className={cn("relative flex min-h-14 flex-1 flex-col items-center justify-center text-xs font-semibold no-underline", on ? "text-brand" : "text-muted")}>
                {it.label}
                {it.key === "inbox" && badges.inbox ? <span className="absolute right-[22%] top-2 h-2 w-2 rounded-full bg-orange" aria-label={`${badges.inbox} need staff`} /> : null}
                {it.key === "notifications" ? <UnreadDot /> : null}
              </Link>
            );
          })}
        </nav>
      </div>
      </NotificationsProvider>
    </MeProvider>
  );
}

function UnreadDot() {
  const { unread } = useNotifications();
  return unread ? <span className="absolute right-[22%] top-2 h-2 w-2 rounded-full bg-orange" aria-label={`${unread} unread`} /> : null;
}
