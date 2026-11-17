"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { playChime } from "@/lib/sound";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";

export interface NotificationRow { id: string; event: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** Bell + realtime feed. Plays a sound per event unless the member switched sound off for it. */
export function NotificationCenter({ dark = false }: { dark?: boolean }) {
  const me = useMe();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NotificationRow | null>(null);
  const soundOff = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30).then(({ data }) => setRows((data ?? []) as NotificationRow[]));
    sb.from("notification_prefs").select("event,sound").then(({ data }) => {
      soundOff.current = new Set((data ?? []).filter((p) => !p.sound).map((p) => p.event));
    });
    const ch = sb.channel(`notif-${me.member_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `member_id=eq.${me.member_id}` }, (p) => {
        const n = p.new as NotificationRow;
        setRows((r) => [n, ...r].slice(0, 30));
        if (!soundOff.current.has(n.event)) playChime();
        setToast(n);
        setTimeout(() => setToast((t) => (t?.id === n.id ? null : t)), 6000);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [me.member_id]);

  const unread = rows.filter((r) => !r.read_at).length;

  async function markAll() {
    await supabaseBrowser().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    setRows((r) => r.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Notifications, ${unread} unread`}
        className={cn("flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium", dark ? "text-sidebar-text hover:bg-sidebar-card" : "text-body hover:bg-chip")}>
        <span>Notifications</span>
        {unread ? <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-orange px-1.5 text-xs font-bold text-[#1D1302]">{unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute bottom-12 left-0 z-50 w-80 rounded-xl border border-line bg-white text-ink shadow-xl">
          <NotificationList rows={rows} onMarkAll={markAll} />
        </div>
      ) : null}
      {toast ? (
        <div role="status" className="fixed bottom-20 right-4 z-50 w-80 rounded-xl border border-warn-line bg-warn-soft p-3 text-warn-ink shadow-lg md:bottom-4">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.body ? <p className="mt-0.5 line-clamp-2 text-sm">{toast.body}</p> : null}
          {toast.link ? <Link href={toast.link} className="mt-1 inline-block text-sm font-semibold">Open</Link> : null}
        </div>
      ) : null}
    </div>
  );
}

export function NotificationList({ rows, onMarkAll }: { rows: NotificationRow[]; onMarkAll: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold">Notifications</p>
        <button type="button" className="text-xs font-semibold text-brand" onClick={onMarkAll}>Mark all read</button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {rows.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">Nothing yet</li> : null}
        {rows.map((n) => (
          <li key={n.id} className={cn("border-b border-line px-4 py-3 last:border-0", !n.read_at && "bg-brand-tint")}>
            <Link href={n.link ?? "#"} className="block text-ink no-underline hover:text-ink">
              <p className="text-sm font-semibold">{n.title}</p>
              {n.body ? <p className="line-clamp-2 text-sm text-muted">{n.body}</p> : null}
              <p className="mt-0.5 text-xs text-faint">{timeAgo(n.created_at)} ago</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
