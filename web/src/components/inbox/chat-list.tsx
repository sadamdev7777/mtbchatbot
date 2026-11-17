"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Avatar } from "@/components/ui/misc";
import type { Directory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STAGES, type Conversation } from "@/lib/types";
import { labelStyle, cn, timeAgo } from "@/lib/utils";

export type InboxTab = "mine" | "team" | "needs" | "unassigned" | "all";
const TABS: { key: InboxTab; label: string }[] = [
  { key: "mine", label: "Mine" }, { key: "team", label: "Team" }, { key: "needs", label: "Needs staff" },
  { key: "unassigned", label: "Unassigned" }, { key: "all", label: "All" },
];

export interface ListFilters { channel: string; label: string; stage: string; agent: string; q: string; showClosed: boolean }

type Row = Conversation & { contact: NonNullable<Conversation["contact"]>; conversation_labels: { label_id: string }[] };

function applyTab(query: any, tab: InboxTab, me: { member_id: string; team_ids: string[] }) {
  switch (tab) {
    case "mine": return query.eq("holder_member_id", me.member_id);
    case "team": return me.team_ids.length ? query.in("team_id", me.team_ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    case "needs": return query.eq("needs_staff", true);
    case "unassigned": return query.is("team_id", null).neq("holder_type", "staff");
    default: return query;
  }
}

export function ChatList({ dir, selected, onSelect, tab, setTab }: {
  dir: Directory; selected: string | null; onSelect: (id: string) => void; tab: InboxTab; setTab: (t: InboxTab) => void;
}) {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Partial<Record<InboxTab, number>>>({});
  const [f, setF] = useState<ListFilters>({ channel: "", label: "", stage: "", agent: "", q: "", showClosed: false });
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    let q = sb.from("conversations")
      .select("*, contact:contacts!inner(id, wa_id, name), conversation_labels(label_id)")
      .order("needs_staff", { ascending: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    q = applyTab(q, tab, me);
    if (!f.showClosed) q = q.neq("status", "closed");
    if (f.channel) q = q.eq("channel_id", f.channel);
    if (f.stage) q = q.eq("stage", f.stage);
    if (f.agent) q = q.eq("agent_id", f.agent);
    if (f.q.trim()) {
      const s = f.q.trim().replace(/[%,()]/g, "");
      q = q.or(`name.ilike.%${s}%,wa_id.ilike.%${s}%`, { referencedTable: "contacts" });
    }
    const { data } = await q;
    let list = (data ?? []) as Row[];
    if (f.label) list = list.filter((r) => r.conversation_labels.some((l) => l.label_id === f.label));
    setRows(list);
    // tab counts (open chats only)
    const entries = await Promise.all(TABS.filter((t) => t.key !== "all").map(async (t) => {
      const { count } = await applyTab(sb.from("conversations").select("id", { count: "exact", head: true }).neq("status", "closed"), t.key, me);
      return [t.key, count ?? 0] as const;
    }));
    setCounts(Object.fromEntries(entries));
  }, [tab, f, me]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb.channel("inbox-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 300);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_labels" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 300);
      })
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { sb.removeChannel(ch); clearInterval(t); };
  }, [load]);

  const labelsById = useMemo(() => new Map(dir.labels.map((l) => [l.id, l])), [dir.labels]);

  return (
    <section aria-label="Chat list" className="flex h-full min-h-0 flex-col border-r border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Inbox</h1>
          <label htmlFor="chan" className="sr-only">Number</label>
          <select id="chan" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}
            className="h-9 rounded-lg border border-input bg-white px-2 text-[13px] font-medium">
            <option value="">All numbers</option>
            {dir.channels.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
        </div>
        <label htmlFor="q" className="sr-only">Search chats</label>
        <input id="q" type="search" placeholder="Search name or number" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}
          className="h-10 rounded-lg border border-input px-3 text-sm" />
        <div role="tablist" aria-label="Filter chats" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const on = tab === t.key;
            const warn = t.key === "needs";
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={cn("h-8 rounded-full border px-3 text-[13px]",
                  on && warn ? "border-warn bg-warn-soft font-semibold text-warn-ink"
                    : on ? "border-brand bg-brand-soft font-semibold text-brand-darker"
                    : "border-input bg-white font-medium text-body")}>
                {t.label}{counts[t.key] !== undefined ? ` ${counts[t.key]}` : ""}
              </button>
            );
          })}
        </div>
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold text-muted">Filters</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select aria-label="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className="h-9 rounded-lg border border-input px-2">
              <option value="">Any label</option>
              {dir.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select aria-label="Stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className="h-9 rounded-lg border border-input px-2">
              <option value="">Any stage</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select aria-label="Agent" value={f.agent} onChange={(e) => setF({ ...f, agent: e.target.value })} className="h-9 rounded-lg border border-input px-2">
              <option value="">Any agent</option>
              {dir.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.showClosed} onChange={(e) => setF({ ...f, showClosed: e.target.checked })} /> Show closed</label>
          </div>
        </details>
      </div>
      {(() => {
        const urgent = rows.find((r) => r.needs_staff);
        return urgent ? (
          <div role="alert" className="md:hidden"><button type="button" onClick={() => onSelect(urgent.id)}
            className="flex w-full items-center justify-between gap-2 border-b border-warn-line bg-warn-soft px-4 py-3 text-left text-sm text-warn-ink">
            <span className="min-w-0"><strong className="block truncate">Needs staff · {urgent.contact.name ?? urgent.contact.wa_id}</strong>
              <span className="block truncate">{urgent.needs_staff_reason}</span></span>
            <span className="shrink-0 font-semibold">Open</span>
          </button></div>
        ) : null;
      })()}
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Chats">
        {rows.length === 0 ? <li className="p-6 text-center text-sm text-muted">No chats here.</li> : null}
        {rows.map((r) => {
          const owner = r.holder_type === "staff" ? dir.member(r.holder_member_id)?.display_name : r.holder_type === "ai" ? `${dir.agent(r.agent_id)?.name ?? "AI"} (AI)` : null;
          const temp = r.conversation_labels.map((l) => labelsById.get(l.label_id)).find((l) => l?.group === "temperature");
          const waitMin = r.needs_staff_since ? Math.floor((now - Date.parse(r.needs_staff_since)) / 60000) : 0;
          return (
            <li key={r.id}>
              <button type="button" onClick={() => onSelect(r.id)} aria-current={selected === r.id ? "true" : undefined}
                className={cn("flex min-h-16 w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-panel", selected === r.id && "bg-brand-tint")}>
                <Avatar name={r.contact.name ?? r.contact.wa_id} light />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{r.contact.name ?? `+${r.contact.wa_id}`}</span>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(r.last_message_at, now)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted">{r.last_message_preview?.replace(/^\*[^*\n]+\*\n/, "") ?? ""}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {r.needs_staff ? <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn-ink">Needs staff · {waitMin}m</span> : null}
                    {temp ? <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={labelStyle(temp.colour)}>{temp.name}</span> : null}
                    {r.status === "closed" ? <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-semibold text-muted">Closed</span> : null}
                    {owner ? <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-medium text-body">{owner}</span> : null}
                    {r.team_id ? <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-medium text-body">{dir.team(r.team_id)?.name}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
