"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HBars, ShareBar } from "@/components/charts/bars";
import { useMe } from "@/components/shell/me-context";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, Stat } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";
import { AgentStatusCard } from "./agent-status";
import { SetupCard } from "./setup-card";

export const RANGES = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
export function rangeDates(r: keyof typeof RANGES): { from: string; to: string } {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 3600_000);
  const startToday = new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate()) - 8 * 3600_000);
  const days = r === "today" ? 0 : r === "7d" ? 6 : 29;
  return { from: new Date(startToday.getTime() - days * 86400000).toISOString(), to: new Date(now.getTime() + 60000).toISOString() };
}
export const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

export function DashboardOverview() {
  const me = useMe();
  const dir = useDirectory();
  const [range, setRange] = useState<keyof typeof RANGES>("today");
  const [team, setTeam] = useState("");
  const [d, setD] = useState<any>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const { from, to } = rangeDates(range);
    supabaseBrowser().rpc("rpc_dashboard", { p_from: from, p_to: to, p_team: team || null }).then(({ data }) => { setD(data); setNow(Date.now()); });
  }, [range, team]);
  const hour = Number(new Date().toLocaleString("en-MY", { hour: "numeric", hour12: false, timeZone: "Asia/Kuala_Lumpur" }));
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{greet}, {me.display_name}</p>
          <p className="text-sm text-muted">{new Date().toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" })} · {me.role === "staff" ? "your chats" : me.role === "team_lead" ? "your teams" : "all teams"}</p>
        </div>
        <div className="flex gap-2">
          <label className="text-[13px] font-semibold">Period <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)} className="h-9 w-40">{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          {me.role !== "staff" ? <label className="text-[13px] font-semibold">Team <Select value={team} onChange={(e) => setTeam(e.target.value)} className="h-9 w-40"><option value="">All teams</option>{dir?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label> : null}
        </div>
      </div>
      {isAdmin(me.role) ? <SetupCard /> : null}
      <AgentStatusCard />
      {!d ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Incoming chats" value={d.incoming_chats} sub={`${d.incoming_chats - d.incoming_prev >= 0 ? "+" : ""}${d.incoming_chats - d.incoming_prev} vs previous period`} />
            <Link href="/inbox?tab=needs" className="no-underline"><Stat label="Needs staff" value={d.needs_staff} tone={d.needs_staff ? "warn" : undefined} sub={`${d.needs_staff_over_1h} waiting over 1 hour · open inbox`} /></Link>
            <Stat label="First reply time (staff)" value={d.first_reply_staff_s ? dur(d.first_reply_staff_s) : "–"} sub={`Bot: ${d.first_reply_bot_s ? dur(d.first_reply_bot_s) : "–"} on average`} />
            <Stat label="Deposits from chat" value={d.deposits} sub={`${d.deposits_bot} from bot, ${d.deposits - d.deposits_bot} from staff`} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Funnel" description="From incoming chat to deposit" />
              <div className="p-5"><HBars label="Funnel" data={d.funnel} />
                {d.priced_no_link ? <p className="mt-3 text-sm text-muted">{d.priced_no_link} chats got a price but never reached the booking link. The night audit will review them.</p> : null}</div>
            </Card>
            <Card>
              <CardHeader title="Bot vs staff" description="Who handled the chats in this period" />
              <div className="flex flex-col gap-3 p-5 text-sm">
                <ShareBar a={{ label: "Bot only", n: d.bot_only }} b={{ label: "Handed to staff", n: d.handed_to_staff }} />
                <ul className="flex flex-col gap-1">{d.handover_reasons.map((r: any) => <li key={r.reason} className="flex justify-between gap-3"><span>{r.reason}</span><strong>{r.n}</strong></li>)}
                  <li className="flex justify-between gap-3"><span>Messages failed to send</span><strong>{d.failed_messages}</strong></li></ul>
              </div>
            </Card>
            <Card>
              <CardHeader title="Waiting longest for staff" action={<Link href="/inbox?tab=needs" className="text-sm font-semibold">View all</Link>} />
              <ul className="divide-y divide-line">
                {d.waiting_longest.length === 0 ? <li className="px-5 py-6 text-center text-sm text-muted">Nobody is waiting.</li> : null}
                {d.waiting_longest.map((w: any) => (
                  <li key={w.id}><Link href={`/inbox?c=${w.id}`} className="flex justify-between gap-3 px-5 py-3 text-sm text-ink no-underline">
                    <span className="min-w-0"><strong>{w.name}</strong><span className="block truncate text-muted">{w.why}</span></span>
                    <span className="shrink-0 text-right"><span className={cn("font-semibold", now - Date.parse(w.since) > 3600_000 ? "text-danger" : "text-warn-ink")}>{timeAgo(w.since, now)}</span><span className="block text-xs text-muted">{w.team}</span></span>
                  </Link></li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Per team" />
              <table className="w-full text-left text-sm"><thead className="text-xs text-muted"><tr><th className="px-5 py-2">Team</th><th className="px-3 py-2">Open</th><th className="px-3 py-2">Needs staff</th></tr></thead>
                <tbody className="divide-y divide-line">{d.teams.map((t: any) => <tr key={t.id}><td className="px-5 py-2">{t.name}</td><td className="px-3 py-2">{t.open}</td><td className={cn("px-3 py-2", t.needs_staff ? "font-semibold text-warn-ink" : "")}>{t.needs_staff}</td></tr>)}</tbody></table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
