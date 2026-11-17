"use client";
import { useEffect, useState } from "react";
import { HBars, VBars } from "@/components/charts/bars";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, Stat } from "@/components/ui/misc";
import { download, toCsv } from "@/lib/csv";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, rm } from "@/lib/utils";
import { dur, RANGES, rangeDates } from "./overview";

const TABS = [["staff", "Staff"], ["bot", "Bot"], ["funnel", "Funnel"], ["cost", "Cost"]] as const;

export function Reports() {
  const me = useMe();
  const [range, setRange] = useState<keyof typeof RANGES>("30d");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("staff");
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const { from, to } = rangeDates(range);
    supabaseBrowser().rpc("rpc_reports", { p_from: from, p_to: to }).then(({ data }) => setD(data));
  }, [range]);

  function exportCsv() {
    if (!d) return;
    const rows: (string | number | null)[][] =
      tab === "staff" ? [["Staff", "Chats", "First reply (s)", "Deposits", "Closing rate %"], ...d.staff.map((s: any) => [s.name, s.chats, s.first_reply_s, s.deposits, s.chats ? Math.round((s.deposits / s.chats) * 100) : 0])]
      : tab === "bot" ? [["Agent", "Chats", "Handovers", "Handover rate %", "Deposits AI only", "Drafts used unedited %"], ...d.bot.map((b: any) => [b.name, b.chats, b.handovers, b.chats ? Math.round((b.handovers / b.chats) * 100) : 0, b.deposits_ai_only, b.drafts_decided ? Math.round((b.drafts_used / b.drafts_decided) * 100) : ""])]
      : tab === "funnel" ? [["Source", "Chats", "Price given", "Booking link", "Deposits"], ...d.funnel_by_source.map((f: any) => [f.source, f.chats, f.price_given, f.booking_link, f.deposits])]
      : [["Item", "RM"], ...d.claude_by_model.map((c: any) => [`Claude ${c.model}`, c.rm]), ...d.meta_templates.map((m: any) => [`Meta ${m.category} templates (${m.sent})`, m.rm]), ["Caching savings", d.caching_savings_rm]];
    download(`report-${tab}-${range}.csv`, toCsv(rows));
  }

  const totalCost = d ? d.claude_by_model.reduce((a: number, c: any) => a + Number(c.rm), 0) + d.meta_templates.reduce((a: number, m: any) => a + Number(m.rm), 0) : 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Report type" className="flex gap-1">
          {TABS.filter(([k]) => k !== "cost" || isAdmin(me.role)).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn("h-9 rounded-full border px-4 text-sm", tab === k ? "border-brand bg-brand-soft font-semibold text-brand-darker" : "border-input bg-white")}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="text-[13px] font-semibold">Period <Select value={range} onChange={(e) => setRange(e.target.value as keyof typeof RANGES)} className="h-9 w-40">{Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
          <Button variant="secondary" onClick={exportCsv} className="self-end">Export CSV</Button>
        </div>
      </div>
      {!d ? <p className="text-sm text-muted">Loading…</p> : null}
      {d && tab === "staff" ? (
        <Card className="overflow-x-auto">
          <CardHeader title="Staff performance" />
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-line bg-panel text-xs text-muted"><tr><th className="px-5 py-2.5">Staff</th><th className="px-3 py-2.5">Chats</th><th className="px-3 py-2.5">First reply</th><th className="px-3 py-2.5">Deposits</th><th className="px-3 py-2.5">Closing rate</th></tr></thead>
            <tbody className="divide-y divide-line">{d.staff.map((s: any) => <tr key={s.id}><td className="px-5 py-2.5 font-semibold">{s.name}</td><td className="px-3 py-2.5">{s.chats}</td><td className="px-3 py-2.5">{s.first_reply_s ? dur(s.first_reply_s) : "–"}</td><td className="px-3 py-2.5">{s.deposits}</td><td className="px-3 py-2.5">{s.chats ? `${Math.round((s.deposits / s.chats) * 100)}%` : "–"}</td></tr>)}</tbody>
          </table>
        </Card>
      ) : null}
      {d && tab === "bot" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="overflow-x-auto lg:col-span-2">
            <CardHeader title="By agent" />
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-panel text-xs text-muted"><tr><th className="px-5 py-2.5">Agent</th><th className="px-3 py-2.5">Chats handled</th><th className="px-3 py-2.5">Handovers</th><th className="px-3 py-2.5">Handover rate</th><th className="px-3 py-2.5">Deposits from AI alone</th><th className="px-3 py-2.5">Drafts used unedited</th></tr></thead>
              <tbody className="divide-y divide-line">{d.bot.map((b: any) => <tr key={b.id}><td className="px-5 py-2.5 font-semibold">{b.name}</td><td className="px-3 py-2.5">{b.chats}</td><td className="px-3 py-2.5">{b.handovers}</td><td className="px-3 py-2.5">{b.chats ? `${Math.round((b.handovers / b.chats) * 100)}%` : "–"}</td><td className="px-3 py-2.5">{b.deposits_ai_only}</td><td className="px-3 py-2.5">{b.drafts_decided ? `${Math.round((b.drafts_used / b.drafts_decided) * 100)}%` : "–"}</td></tr>)}</tbody>
            </table>
          </Card>
          <Card><CardHeader title="Chats the bot handed to staff, by day" /><div className="p-5"><VBars label="Handovers per day" data={d.handovers_by_day.map((x: any) => ({ label: x.day, n: x.n }))} /></div></Card>
          <Card><CardHeader title="Reasons for handing to staff" /><div className="p-5"><HBars label="Handover reasons" data={d.handover_reasons.map((r: any) => ({ label: r.reason, n: r.n }))} /></div></Card>
        </div>
      ) : null}
      {d && tab === "funnel" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="overflow-x-auto lg:col-span-2">
            <CardHeader title="Funnel by source" />
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-panel text-xs text-muted"><tr><th className="px-5 py-2.5">Source</th><th className="px-3 py-2.5">Incoming chats</th><th className="px-3 py-2.5">Price given</th><th className="px-3 py-2.5">Booking link</th><th className="px-3 py-2.5">Deposit</th></tr></thead>
              <tbody className="divide-y divide-line">{d.funnel_by_source.map((f: any) => <tr key={f.source}><td className="px-5 py-2.5 font-semibold">{f.source}</td><td className="px-3 py-2.5">{f.chats}</td><td className="px-3 py-2.5">{f.price_given}</td><td className="px-3 py-2.5">{f.booking_link}</td><td className="px-3 py-2.5">{f.deposits}</td></tr>)}</tbody>
            </table>
          </Card>
          <Card><CardHeader title="Why they dropped out" description="From the buttons in the final template" /><div className="p-5">{d.lost_reasons.length ? <HBars label="Lost reasons" data={d.lost_reasons.map((r: any) => ({ label: r.reason, n: r.n }))} /> : <p className="text-sm text-muted">No answers yet.</p>}</div></Card>
        </div>
      ) : null}
      {d && tab === "cost" && isAdmin(me.role) ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Claude" value={rm(d.claude_by_model.reduce((a: number, c: any) => a + Number(c.rm), 0))} />
            <Stat label="Meta templates" value={rm(d.meta_templates.reduce((a: number, m: any) => a + Number(m.rm), 0))} sub="Replies within the 24-hour window are free" />
            <Stat label="Cost per deposit" value={d.deposits ? rm(Math.round((totalCost / d.deposits) * 100) / 100) : "–"} sub={`total ÷ ${d.deposits} deposits`} />
            <Stat label="Prompt caching savings" value={rm(d.caching_savings_rm)} />
          </div>
          <Card className="overflow-x-auto">
            <CardHeader title="Claude by model" />
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-panel text-xs text-muted"><tr><th className="px-5 py-2.5">Model</th><th className="px-3 py-2.5">Input tokens</th><th className="px-3 py-2.5">Output tokens</th><th className="px-3 py-2.5">Cache reads</th><th className="px-3 py-2.5">Cost</th></tr></thead>
              <tbody className="divide-y divide-line">{d.claude_by_model.map((c: any) => <tr key={c.model}><td className="px-5 py-2.5">{c.model}</td><td className="px-3 py-2.5">{Number(c.input_tokens).toLocaleString()}</td><td className="px-3 py-2.5">{Number(c.output_tokens).toLocaleString()}</td><td className="px-3 py-2.5">{Number(c.cache_read_tokens).toLocaleString()}</td><td className="px-3 py-2.5">{rm(Number(c.rm))} (${c.usd})</td></tr>)}</tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto">
            <CardHeader title="Meta templates by category" />
            <table className="w-full text-left text-sm"><tbody className="divide-y divide-line">{d.meta_templates.map((m: any) => <tr key={m.category}><td className="px-5 py-2.5">{m.category}</td><td className="px-3 py-2.5">{m.sent} sent</td><td className="px-3 py-2.5">{rm(Number(m.rm))}</td></tr>)}</tbody></table>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
