"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";

interface Rule { id: string; priority: number; type: "ad" | "keyword" | "ask" | "fallback"; match: any; target_agent_id: string | null; target_team_id: string | null; enabled: boolean }

export function RouterEditor() {
  const me = useMe();
  const admin = isAdmin(me.role);
  const dir = useDirectory();
  const sb = supabaseBrowser();
  const [rules, setRules] = useState<Rule[]>([]);
  const [ads, setAds] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("routing_rules").select("*").order("priority");
    setRules((data ?? []) as Rule[]);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: ev } = await sb.from("messages").select("meta").eq("type", "event").gte("created_at", since).contains("meta", { kind: "route" });
    const s: Record<string, number> = {};
    for (const e of ev ?? []) s[e.meta.via] = (s[e.meta.via] ?? 0) + 1;
    setStats(s);
  }, [sb]);
  useEffect(() => {
    load();
    callFunction<{ ads: { id: string; name: string }[] }>("integration-test", { action: "list_ads" }).then((r) => setAds(r.ads)).catch(() => {});
  }, [load]);

  async function save(r: Rule, p: Partial<Rule>) {
    const { error } = await sb.from("routing_rules").update(p).eq("id", r.id);
    setMsg(error ? error.message : "Saved");
    load();
  }
  async function add(type: Rule["type"], match: any, priority: number) {
    await sb.from("routing_rules").insert({ company_id: me.company_id, type, match, priority, target_agent_id: dir?.agents[0]?.id ?? null });
    load();
  }
  async function remove(id: string) {
    await sb.from("routing_rules").delete().eq("id", id);
    load();
  }
  if (!dir) return null;
  const target = (r: Rule) => (
    <Select aria-label="Send to" className="h-9 max-w-56" disabled={!admin} value={r.target_agent_id ? `a:${r.target_agent_id}` : r.target_team_id ? `t:${r.target_team_id}` : ""}
      onChange={(e) => { const [k, id] = e.target.value.split(":"); save(r, { target_agent_id: k === "a" ? id : null, target_team_id: k === "t" ? id : null }); }}>
      <optgroup label="AI agents">{dir.agents.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name} (AI)</option>)}</optgroup>
      <optgroup label="Staff teams">{dir.teams.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}</optgroup>
    </Select>
  );
  const ask = rules.find((r) => r.type === "ask");
  const fallback = rules.find((r) => r.type === "fallback");
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header><p className="text-sm text-muted"><Link href="/ai">AI Team</Link> / Router</p><h1 className="text-2xl font-bold">Router</h1>
        <p className="text-sm text-muted">Decide which agent handles each new chat. Rules are read top to bottom; the first match wins. Haiku classifies free text only when the keywords are inconclusive.</p></header>
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="1 · By the ad the customer clicked" description="Click-to-WhatsApp ad referral in the first message." action={admin ? <Button size="sm" variant="secondary" onClick={() => add("ad", { source_ids: [] }, 10)}>+ Ad rule</Button> : null} />
            <ul className="divide-y divide-line">
              {rules.filter((r) => r.type === "ad").map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  {ads.length ? (
                    <Select aria-label="Ad" className="h-9 max-w-72" value={r.match.source_ids?.[0] ?? ""} disabled={!admin} onChange={(e) => save(r, { match: { source_ids: [e.target.value] } })}>
                      <option value="">Choose an ad</option>{ads.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  ) : (
                    <Input aria-label="Ad IDs" className="h-9 max-w-72" placeholder="Ad ID(s), comma separated" defaultValue={(r.match.source_ids ?? []).join(", ")} disabled={!admin}
                      onBlur={(e) => save(r, { match: { source_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} />
                  )}
                  <span>→</span>{target(r)}
                  {admin ? <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>Remove</Button> : null}
                </li>
              ))}
            </ul>
            <p className="px-5 pb-4 text-xs text-muted">{ads.length ? "Ads from Meta Ads." : "Meta Ads is not connected: paste ad IDs by hand."} New ads without a rule use the keywords below.</p>
          </Card>
          <Card>
            <CardHeader title="2 · By keywords in the first message" action={admin ? <Button size="sm" variant="secondary" onClick={() => add("keyword", { keywords: [] }, 20)}>+ Keyword rule</Button> : null} />
            <ul className="divide-y divide-line">
              {rules.filter((r) => r.type === "keyword").map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <Input aria-label="Keywords" className="h-9 min-w-0 flex-1" defaultValue={(r.match.keywords ?? []).join(", ")} disabled={!admin}
                    onBlur={(e) => save(r, { match: { keywords: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) } })} />
                  <span>→</span>{target(r)}
                  {admin ? <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>Remove</Button> : null}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3 p-5 text-sm">
            <h2 className="font-semibold">3 · If unclear</h2>
            <label className="flex items-center gap-2"><input type="radio" name="unclear" checked={!!ask?.enabled} disabled={!admin || !ask} onChange={() => ask && save(ask, { enabled: true })} /> Ask the customer with destination buttons</label>
            {ask ? <div className="ml-6 rounded-lg bg-chat-bg p-3"><p className="rounded-lg bg-white p-2">{ask.match.text}</p>
              <div className="mt-1 flex gap-1">{(ask.match.buttons ?? []).map((b: any) => <span key={b.id} className="rounded-lg bg-white px-3 py-1 text-info">{b.title}</span>)}</div></div> : null}
            <label className="flex items-center gap-2"><input type="radio" name="unclear" checked={!ask?.enabled} disabled={!admin || !ask} onChange={() => ask && save(ask, { enabled: false })} /> Straight to the general staff team</label>
            {fallback ? <div className="flex items-center gap-2">Fallback team: {target(fallback)}</div> : null}
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="font-semibold">4 · Customer asks about two destinations</h2>
            <p className="mt-1 text-muted">Example: &ldquo;Nak tanya Kundasang dan Korea.&rdquo; The first agent answers its own destination, then offers to continue with the other. If yes, it hands the chat over with a summary (reason &ldquo;not my package&rdquo;). A chat still has only one owner at a time.</p>
          </Card>
        </div>
        <aside><Card className="p-5 text-sm"><h2 className="font-semibold">Last 30 days</h2>
          <ul className="mt-2 flex flex-col gap-1">{["ad", "keyword", "classifier", "ask", "fallback"].map((k) => <li key={k} className="flex justify-between"><span className="capitalize">{k}</span><strong>{stats[k] ?? 0}</strong></li>)}</ul>
          <p className="mt-2 text-xs text-muted">Misroutes show up as handovers with the reason &ldquo;not my package&rdquo;.</p></Card></aside>
      </div>
    </div>
  );
}
