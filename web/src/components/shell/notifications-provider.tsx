"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { playChime } from "@/lib/sound";
import { supabaseBrowser } from "@/lib/supabase/client";

export interface NotificationRow { id: string; event: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }
interface Toast { id: string; title: string; body?: string | null; link?: string | null; tone: "warn" | "info" }
interface Ctx { rows: NotificationRow[]; unread: number; markAll: () => Promise<void> }

const NotificationsContext = createContext<Ctx>({ rows: [], unread: 0, markAll: async () => {} });
export const useNotifications = () => useContext(NotificationsContext);

/** One realtime listener per session: notification feed, in-app toasts, sounds, and Needs-staff alerts. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const soundOff = useRef<Set<string>>(new Set());

  const toast = useCallback((t: Toast) => {
    setToasts((x) => [t, ...x.filter((y) => y.id !== t.id)].slice(0, 3));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 8000);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const sb = supabaseBrowser();
    sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => setRows((data ?? []) as NotificationRow[]));
    sb.from("notification_prefs").select("event,sound").then(({ data }) => {
      soundOff.current = new Set((data ?? []).filter((p) => !p.sound).map((p) => p.event));
    });
    const ch = sb.channel(`notif-${me.member_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `member_id=eq.${me.member_id}` }, (p) => {
        const n = p.new as NotificationRow;
        setRows((r) => [n, ...r].slice(0, 50));
        if (!soundOff.current.has(n.event)) playChime();
        toast({ id: n.id, title: n.title, body: n.body, link: n.link, tone: "info" });
      });
    if (me.role !== "accounts") {
      // In-app alert for chats that newly need staff (RLS limits this to chats I can see).
      ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, (p) => {
        const n = p.new as { id: string; needs_staff: boolean; needs_staff_reason: string | null };
        const o = p.old as { needs_staff?: boolean };
        if (n.needs_staff && o.needs_staff === false) {
          if (!soundOff.current.has("needs_staff_assigned")) playChime();
          toast({ id: `ns-${n.id}`, title: "Chat needs staff", body: n.needs_staff_reason, link: `/inbox?c=${n.id}`, tone: "warn" });
        }
      });
    }
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [me.member_id, me.role, toast]);

  const markAll = useCallback(async () => {
    await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setRows((r) => r.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
  }, []);

  return (
    <NotificationsContext value={{ rows, unread: rows.filter((r) => !r.read_at).length, markAll }}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-20 z-50 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-80" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto rounded-xl border p-3 shadow-lg ${t.tone === "warn" ? "border-warn-line bg-warn-soft text-warn-ink" : "border-line bg-white text-ink"}`}>
            <p className="text-sm font-semibold">{t.title}</p>
            {t.body ? <p className="mt-0.5 line-clamp-2 text-sm">{t.body}</p> : null}
            <div className="mt-1 flex gap-3">
              {t.link ? <Link href={t.link} className="inline-flex min-h-11 items-center text-sm font-semibold md:min-h-0">Open</Link> : null}
              <button type="button" className="min-h-11 text-sm text-muted md:min-h-0" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </NotificationsContext>
  );
}
