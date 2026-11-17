"use client";
import Link from "next/link";
import { useState } from "react";
import { useNotifications, type NotificationRow } from "@/components/shell/notifications-provider";
import { cn, timeAgo } from "@/lib/utils";

/** Sidebar bell with a dropdown of recent notifications. */
export function NotificationCenter({ dark = false }: { dark?: boolean }) {
  const { rows, unread, markAll } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Notifications, ${unread} unread`}
        className={cn("flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium", dark ? "text-sidebar-text hover:bg-sidebar-card" : "text-body hover:bg-chip")}>
        <span>Notifications</span>
        {unread ? <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-orange px-1.5 text-xs font-bold text-[#1D1302]">{unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute bottom-12 left-0 z-50 w-80 rounded-xl border border-line bg-white text-ink shadow-xl">
          <NotificationList rows={rows.slice(0, 20)} onMarkAll={markAll} />
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
        <button type="button" className="min-h-11 text-xs font-semibold text-brand md:min-h-0" onClick={onMarkAll}>Mark all read</button>
      </div>
      <ul className="max-h-[70dvh] overflow-y-auto">
        {rows.length === 0 ? <li className="px-4 py-6 text-center text-sm text-muted">Nothing yet</li> : null}
        {rows.map((n) => (
          <li key={n.id} className={cn("border-b border-line last:border-0", !n.read_at && "bg-brand-tint")}>
            <Link href={n.link ?? "#"} className="block min-h-11 px-4 py-3 text-ink no-underline hover:text-ink">
              <p className="text-sm font-semibold">{n.title}</p>
              {n.body ? <p className="line-clamp-2 text-sm text-muted">{n.body}</p> : null}
              <p className="mt-0.5 text-xs text-muted">{timeAgo(n.created_at)} ago</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
