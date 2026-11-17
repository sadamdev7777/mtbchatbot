"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, CardHeader, Stat, Toggle } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, fmtDate, rm } from "@/lib/utils";
import { AgentAvatar, StatusPill } from "./common";
import { KnowledgeEditor } from "./knowledge-editor";
import { OfficialAnswers } from "./official-answers";

interface Agent {
  id: string; name: string; avatar_color: string; description: string | null; destination: string | null; persona: string; team_id: string | null;
  default_staff_member_id: string | null; mode: string; schedule: any; status: string; travelboost_product_ids: string[]; destination_keywords: string[];
  model_chat: string | null; close_sale_instructions: string; aftersales_instructions: string; approved_at: string | null;
}
const TABS = [["profile", "Profile"], ["knowledge", "Knowledge"], ["close", "Close sale"], ["after", "After-sales"], ["follow", "Follow-up"], ["perf", "Performance"]] as const;
const MODES = [
  ["follow_schedule", "Follow schedule", "Assist in office hours (Mon–Fri 9–18, Sat 9–13), Auto otherwise"],
  ["auto", "Auto", "AI replies to customers"],
  ["assist", "Assist", "AI writes drafts only; staff sends"],
  ["off", "Off", "AI does nothing"],
] as const;

export function AgentProfile({ id }: { id: string }) {
  const me = useMe();
  const admin = isAdmin(me.role);
  const dir = useDirectory();
  const sb = supabaseBrowser();
  const [a, setA] = useState<Agent | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("profile");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("agents").select("*").eq("id", id).maybeSingle();
    setA(data as Agent | null);
  }, [sb, id]);
  useEffect(() => { load(); }, [load]);

  async function patch(p: Partial<Agent>) {
    const { error } = await sb.from("agents").update(p).eq("id", id);
    setMsg(error ? error.message : "Saved");
    setTimeout(() => setMsg(""), 2000);
    load();
  }

  if (!a || !dir) return <div className="p-8 text-sm text-muted">Loading…</div>;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-col gap-4">
        <Link href="/ai" className="text-sm font-semibold">← AI Team</Link>
        <div className="flex flex-wrap items-center gap-4">
          <AgentAvatar name={a.name} colour={a.avatar_color} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{a.name}</h1>
            <p className="text-sm text-muted"><StatusPill status={a.status} /> · TravelBoost product: {a.travelboost_product_ids.join(", ") || "not linked"} · {a.destination}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {admin && a.status !== "training" ? <Button variant="secondary" onClick={() => patch({ status: a.status === "live" ? "resting" : "live" })}>{a.status === "live" ? "Rest agent" : "Back on duty"}</Button> : null}
            {a.status === "training" && admin ? <Link href={`/ai/new?agent=${a.id}`} className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white no-underline hover:text-white">Continue setup</Link> : null}
            <Link href={`/ai/test?agent=${a.id}`} className="inline-flex h-10 items-center rounded-lg border border-input bg-white px-4 text-sm font-semibold text-body no-underline">Test chat</Link>
            <Link href={`/inbox?tab=all`} className="inline-flex h-10 items-center rounded-lg border border-input bg-white px-4 text-sm font-semibold text-body no-underline">View chats</Link>
          </div>
        </div>
        <div role="tablist" aria-label="Profile sections" className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm", tab === k ? "border-brand font-semibold text-brand-darker" : "border-transparent font-medium text-muted")}>{l}</button>
          ))}
        </div>
        {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      </header>

      {tab === "profile" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Work mode</h2>
            <div role="radiogroup" aria-label="Work mode" className="grid gap-2 sm:grid-cols-2">
              {MODES.map(([k, n, d]) => (
                <button key={k} type="button" role="radio" aria-checked={a.mode === k} disabled={!admin} onClick={() => patch({ mode: k })}
                  className={cn("rounded-lg p-3 text-left", a.mode === k ? "border-2 border-brand bg-brand-tint" : "border border-line bg-white")}>
                  <span className="block text-sm font-semibold">{n}</span><span className="block text-xs text-muted">{d}</span>
                </button>
              ))}
            </div>
            {a.status !== "live" ? <p className="text-xs text-warn-ink">While in {a.status}, the agent only writes drafts, even in Auto.</p> : null}
            <div className="rounded-lg bg-panel p-3 text-sm">
              <p className="font-semibold">Avoiding clashes with staff (all modes)</p>
              <ul className="mt-1 list-disc pl-5 text-body">
                <li>One chat, one owner. Staff sends a message = staff becomes the owner, {a.name} goes quiet.</li>
                <li>Staff starts typing = {a.name} waits 2 minutes. Unsent replies are cancelled.</li>
                <li>A chat only returns to {a.name} when staff clicks &ldquo;Return to bot&rdquo;.</li>
              </ul>
            </div>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Name the customer sees</h2>
            <p className="text-sm text-muted">&ldquo;{a.name}&rdquo; is an internal name only. The customer sees the name of the staff member who owns the lead, or this default.</p>
            <Field label="Default staff name" htmlFor="ag-staff">
              <Select id="ag-staff" value={a.default_staff_member_id ?? ""} disabled={!admin} onChange={(e) => patch({ default_staff_member_id: e.target.value || null })}>
                <option value="">Muslimtravelbug</option>{dir.members.filter((m) => m.status === "active" && m.role !== "accounts").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </Select>
            </Field>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p className="rounded-lg bg-bubble-out p-3"><strong>*{dir.member(a.default_staff_member_id)?.display_name ?? "Muslimtravelbug"}*</strong><br />Baik puan, saya hold seat dulu.<span className="block text-xs text-muted">When staff replies</span></p>
              <p className="rounded-lg bg-bubble-out p-3"><strong>*Pembantu AI · {dir.member(a.default_staff_member_id)?.display_name ?? "Muslimtravelbug"}*</strong><br />Mac 2027 ada beberapa tarikh…<span className="block text-xs text-muted">When AI replies</span></p>
            </div>
            <p className="text-xs text-muted">If the customer asks &ldquo;ni bot ke?&rdquo;, the AI answers honestly and offers to connect them to staff.</p>
          </Card>
          <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
            <h2 className="font-semibold">Personality & setup</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Persona" htmlFor="ag-persona"><Textarea id="ag-persona" rows={4} defaultValue={a.persona} disabled={!admin} onBlur={(e) => e.target.value !== a.persona && patch({ persona: e.target.value })} /></Field>
              <div className="flex flex-col gap-3">
                <Field label="Hand over to team" htmlFor="ag-team"><Select id="ag-team" value={a.team_id ?? ""} disabled={!admin} onChange={(e) => patch({ team_id: e.target.value || null })}>
                  <option value="">None</option>{dir.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                <Field label="Chat model" htmlFor="ag-model"><Select id="ag-model" value={a.model_chat ?? ""} disabled={!admin} onChange={(e) => patch({ model_chat: e.target.value || null })}>
                  <option value="">Company default (Claude Sonnet 5.5)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5</option><option value="claude-opus-5-5">Claude Opus 5.5</option><option value="claude-haiku-5-5">Claude Haiku 5.5</option></Select></Field>
                <Field label="TravelBoost product IDs (comma separated)" htmlFor="ag-prod"><Input id="ag-prod" defaultValue={a.travelboost_product_ids.join(", ")} disabled={!admin}
                  onBlur={(e) => patch({ travelboost_product_ids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></Field>
                <Field label="Router keywords (comma separated)" htmlFor="ag-kw"><Input id="ag-kw" defaultValue={a.destination_keywords.join(", ")} disabled={!admin}
                  onBlur={(e) => patch({ destination_keywords: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} /></Field>
              </div>
            </div>
            <p className="text-xs text-muted">Language style is inherited from Company knowledge (updated by the night job).{a.approved_at ? ` Approved to go live on ${fmtDate(a.approved_at)}.` : ""}</p>
          </Card>
        </div>
      ) : null}

      {tab === "knowledge" ? (
        <div className="flex flex-col gap-5">
          <p role="note" className="rounded-lg bg-panel px-4 py-3 text-sm"><strong>Inherited from Company knowledge:</strong> payment methods, bank account, general cancellation policy, language style. <Link href="/ai/knowledge">Open</Link></p>
          <KnowledgeEditor scope="agent" agentId={a.id} defaultSections={["package", "hotels", "faq"]} />
          <Itineraries agentId={a.id} />
          <OfficialAnswers agentId={a.id} />
          <Card className="p-5"><h2 className="font-semibold">Live data from TravelBoost</h2><p className="mt-1 text-sm text-muted">Dates, prices and seats are not stored here. {a.name} pulls them every time a customer asks.</p></Card>
        </div>
      ) : null}

      {tab === "close" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Close sale mode</h2>
            <p className="text-sm text-muted">Active when the customer stage is <strong>Lead</strong> or <strong>Booking</strong>. Goal: the customer locks a seat and pays the deposit.</p>
            <ol className="list-decimal pl-5 text-sm">
              <li>Ask for month and number of pax</li><li>List at most 8 dates with price and seats</li><li>Answer package questions from knowledge</li>
              <li>Ask for booking details: lead guest&apos;s name, IC, email</li><li>Send the TravelBoost seat-lock link (24-hour hold)</li><li>Seat locked: hand over to staff to send the payment link</li>
            </ol>
            <Field label="Extra instructions" htmlFor="ag-cs"><Textarea id="ag-cs" rows={4} defaultValue={a.close_sale_instructions} disabled={!admin} onBlur={(e) => patch({ close_sale_instructions: e.target.value })} /></Field>
          </Card>
          <Card className="flex flex-col gap-2 p-5 text-sm">
            <h2 className="font-semibold">Must hand over to staff when</h2>
            <p>→ Customer asks to talk to a person<br />→ Question not in knowledge or an official answer<br />→ Not enough seats and the customer insists (never says &ldquo;full&rdquo; unless 0 seats)<br />→ Payment issue or complaint<br />→ Failed to understand twice<br />→ Customer agreed and needs something the tools can&apos;t do</p>
            <h2 className="mt-3 font-semibold">Skills</h2>
            <p className="text-muted">Check seats & prices · Explain itinerary · Lock seat (TravelBoost link) · Official answers · Labels · Follow-ups</p>
          </Card>
        </div>
      ) : null}

      {tab === "after" ? <AfterSales agent={a} admin={admin} onPatch={patch} /> : null}
      {tab === "follow" ? <FollowUps agentId={a.id} admin={admin} /> : null}
      {tab === "perf" ? <Performance agentId={a.id} /> : null}
    </div>
  );
}

function Itineraries({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<{ id: string; file_name: string | null; travelboost_product_id: string; applies_to: any; status: string; created_at: string }[]>([]);
  useEffect(() => {
    supabaseBrowser().from("itineraries").select("id, file_name, travelboost_product_id, applies_to, status, created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).then(({ data }) => setRows(data ?? []));
  }, [agentId]);
  return (
    <Card>
      <CardHeader title="Itineraries" action={<Link href={`/ai/itinerary/new?agent=${agentId}`} className="text-sm font-semibold">+ Upload</Link>} />
      <ul className="divide-y divide-line">
        {rows.length === 0 ? <li className="px-5 py-4 text-sm text-muted">No itinerary uploaded yet.</li> : null}
        {rows.map((r) => (
          <li key={r.id}><Link href={`/ai/itinerary/${r.id}`} className="flex justify-between gap-3 px-5 py-3 text-sm text-ink no-underline">
            <span>{r.file_name ?? "Itinerary"} · {r.travelboost_product_id} · {r.applies_to === "all" ? "all dates" : `${(r.applies_to as string[]).length} dates`}</span>
            <span className={r.status === "active" ? "font-semibold text-success" : r.status === "needs_answers" ? "font-semibold text-warn" : "text-muted"}>{r.status.replace("_", " ")}</span>
          </Link></li>
        ))}
      </ul>
    </Card>
  );
}

function AfterSales({ agent, admin, onPatch }: { agent: Agent; admin: boolean; onPatch: (p: Partial<Agent>) => void }) {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<{ id: string; key: string; days_before_trip: number | null; action: string; template_name: string | null; enabled: boolean; agent_id: string | null }[]>([]);
  const load = useCallback(async () => {
    const { data } = await sb.from("aftersales_schedule").select("*").or(`agent_id.is.null,agent_id.eq.${agent.id}`).order("days_before_trip", { ascending: false, nullsFirst: true });
    setRows(data ?? []);
  }, [sb, agent.id]);
  useEffect(() => { load(); }, [load]);
  const LABEL: Record<string, string> = { thank_receipt_itinerary: "Thank the customer, send the receipt and itinerary PDF", collect_passports: "Collect passports", balance_reminder: "Balance reminder", balance_deadline: "Balance deadline; if unpaid, hand over to staff", final_itinerary: "Final itinerary" };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="After-sales mode" description="Activates automatically when the deposit is received · stage Deposit or Full payment" />
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span><strong>{r.days_before_trip === null ? "On deposit" : `${r.days_before_trip} days before`}</strong> · {LABEL[r.action] ?? r.action}{r.template_name ? <span className="text-xs text-muted"> · template {r.template_name}</span> : null}</span>
              <Toggle checked={r.enabled} disabled={!admin} label={`Turn on ${r.key}`} onChange={async (v) => { await sb.from("aftersales_schedule").update({ enabled: v }).eq("id", r.id); load(); }} />
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-xs text-muted">Messages after the 24-hour window use approved templates.</p>
      </Card>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Extra after-sales instructions</h2>
        <Textarea aria-label="After-sales instructions" rows={5} defaultValue={agent.aftersales_instructions} disabled={!admin} onBlur={(e) => onPatch({ aftersales_instructions: e.target.value })} />
        <p className="text-sm">Must hand over when: the customer asks to change date or cancel, a balance payment failed, or there is a complaint during the trip.</p>
      </Card>
    </div>
  );
}

function FollowUps({ agentId, admin }: { agentId: string; admin: boolean }) {
  const me = useMe();
  const sb = supabaseBrowser();
  const [steps, setSteps] = useState<any[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<{ k: string; v: number }[]>([]);
  const load = useCallback(async () => {
    const { data } = await sb.from("followup_steps").select("*").or(`agent_id.is.null,agent_id.eq.${agentId}`).order("sort");
    const byKey = new Map<string, any>();
    for (const s of data ?? []) if (!byKey.has(s.key) || s.agent_id) byKey.set(s.key, s);
    setSteps([...byKey.values()]);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: jobs } = await sb.from("followup_jobs").select("step_key, status, result").gte("created_at", since).eq("kind", "followup");
    const r: Record<string, string> = {};
    for (const k of new Set((jobs ?? []).map((j) => j.step_key))) {
      const done = (jobs ?? []).filter((j) => j.step_key === k && j.status === "done").length;
      const replied = (jobs ?? []).filter((j) => j.step_key === k && j.result === "customer_replied").length;
      r[k] = done ? `${Math.round((replied / Math.max(done, 1)) * 100)}%` : "–";
    }
    setRates(r);
    const { data: lostRows } = await sb.from("conversations").select("lost_reason").not("lost_reason", "is", null).gte("updated_at", since);
    const m = new Map<string, number>();
    for (const l of lostRows ?? []) m.set(l.lost_reason, (m.get(l.lost_reason) ?? 0) + 1);
    setLost([...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v));
  }, [sb, agentId]);
  useEffect(() => { load(); }, [load]);

  /** Editing a company default creates an agent-specific copy (other agents keep the default). */
  async function update(s: any, p: Record<string, unknown>) {
    if (s.agent_id) await sb.from("followup_steps").update(p).eq("id", s.id);
    else {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = s;
      void _id; void _c; void _u;
      await sb.from("followup_steps").insert({ ...rest, ...p, agent_id: agentId, company_id: me.company_id });
    }
    load();
  }
  const fmt = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)} days` : m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`);
  const groups = [["close_sale", "Close sale"], ["after_sales", "After the trip"], ["event", "From TravelBoost events"]];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="Follow-up sequence by where the customer stopped" description="Reply rate, last 30 days. Turn steps on or off; delays are editable." />
        {groups.map(([g, label]) => (
          <div key={g}>
            <p className="bg-panel px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            <ul className="divide-y divide-line">
              {steps.filter((s) => s.mode === g).map((s) => (
                <li key={s.key} className={cn("flex items-center justify-between gap-3 px-5 py-3 text-sm", !s.enabled && "opacity-60")}>
                  <span className="min-w-0">
                    <strong>{s.trigger.replace(/_/g, " ")}</strong> · after <input aria-label={`Delay in minutes for ${s.key}`} type="number" className="w-20 rounded border border-input px-1" defaultValue={s.delay_minutes} disabled={!admin}
                      onBlur={(e) => Number(e.target.value) !== s.delay_minutes && update(s, { delay_minutes: Number(e.target.value) })} /> min ({fmt(s.delay_minutes)})
                    <span className="block text-xs text-muted">{s.message_kind === "template" ? `Template ${s.template_name}` : `Free AI message: ${s.prompt_hint ?? ""}`}</span>
                  </span>
                  <span className="flex items-center gap-3"><span className="text-xs text-muted"><strong>{rates[s.key] ?? "–"}</strong> reply</span>
                    <Toggle checked={s.enabled} disabled={!admin} label={`Turn on ${s.key}`} onChange={(v) => update(s, { enabled: v })} /></span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
      <div className="flex flex-col gap-5">
        <Card className="p-5 text-sm">
          <h2 className="font-semibold">When to stop</h2>
          <p className="mt-2">■ Customer replies, says not interested, or taps &ldquo;Tak jadi&rdquo;<br />■ 2 templates already sent for this enquiry<br />■ Staff has taken over: staff gets a reminder, bot stays quiet<br />■ Quiet hours: 10 pm – 8 am, and Friday prayers<br />■ Customer opted out</p>
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="font-semibold">Why customers dropped out (30 days)</h2>
          {lost.length ? <ul className="mt-2">{lost.map((l) => <li key={l.k} className="flex justify-between"><span>{l.k}</span><strong>{l.v}</strong></li>)}</ul> : <p className="mt-2 text-muted">No answers yet. Reasons come from the buttons of sebab_tak_jadi_v1.</p>}
        </Card>
      </div>
    </div>
  );
}

function Performance({ agentId }: { agentId: string }) {
  const [s, setS] = useState<{ chats: number; handovers: number; deposits: number; draftsUsed: string; cost: number; reasons: [string, number][] } | null>(null);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: convs } = await sb.from("conversations").select("id, stage, holder_type, needs_staff_reason").eq("agent_id", agentId).gte("created_at", since);
      const { data: runs } = await sb.from("ai_runs").select("decision, cost").eq("agent_id", agentId).gte("created_at", since);
      const { data: drafts } = await sb.from("ai_drafts").select("status").eq("agent_id", agentId).gte("created_at", since);
      const decided = (drafts ?? []).filter((d) => ["used", "edited", "discarded"].includes(d.status));
      const reasons = new Map<string, number>();
      for (const c of convs ?? []) if (c.needs_staff_reason) reasons.set(c.needs_staff_reason, (reasons.get(c.needs_staff_reason) ?? 0) + 1);
      setS({
        chats: convs?.length ?? 0, handovers: (runs ?? []).filter((r) => r.decision === "handover").length,
        deposits: (convs ?? []).filter((c) => ["deposit", "full_payment"].includes(c.stage)).length,
        draftsUsed: decided.length ? `${Math.round((decided.filter((d) => d.status === "used").length / decided.length) * 100)}%` : "–",
        cost: (runs ?? []).reduce((a, r) => a + Number(r.cost), 0), reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      });
    })();
  }, [agentId]);
  if (!s) return null;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Chats (30 days)" value={s.chats} /><Stat label="Handovers" value={s.handovers} /><Stat label="Deposits" value={s.deposits} />
        <Stat label="Drafts used unedited" value={s.draftsUsed} /><Stat label="Claude cost" value={`$${s.cost.toFixed(2)}`} sub={rm(s.cost * 4.4) + " approx."} />
      </div>
      <Card className="p-5 text-sm"><h2 className="font-semibold">Top handover reasons</h2>
        <ul className="mt-2">{s.reasons.map(([k, v]) => <li key={k} className="flex justify-between gap-3"><span>{k}</span><strong>{v}</strong></li>)}</ul>
        <Link href="/dashboard/reports" className="mt-3 inline-block font-semibold">Full report</Link></Card>
    </div>
  );
}
