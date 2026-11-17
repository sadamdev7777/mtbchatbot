"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STAGES, templateBody, templateVarCount, type Template } from "@/lib/types";
import { fmtDate, fmtTime, rm } from "@/lib/utils";

interface Broadcast {
  id: string; name: string; template_name: string; status: string; scheduled_at: string | null; started_at: string | null; created_at: string;
  estimated_cost: number | null; stats?: Record<string, number>;
}
type Mapping = Record<string, { source: "contact.name" | "static"; value?: string; fallback?: string }>;

export function BroadcastApp() {
  const me = useMe();
  const admin = isAdmin(me.role);
  const dir = useDirectory();
  const params = useSearchParams();
  const sb = supabaseBrowser();
  const [past, setPast] = useState<Broadcast[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [destinations, setDestinations] = useState<string[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [seg, setSeg] = useState({ stages: [] as string[], destinations: [] as string[], label_ids: [] as string[], last_chat_days: "" });
  const [count, setCount] = useState<{ recipients: number; not_opted_in_or_opted_out: number } | null>(null);
  const [name, setName] = useState("");
  const [tplName, setTplName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [handover, setHandover] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("schedule");
  const [at, setAt] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(30);
    const list = (data ?? []) as Broadcast[];
    const { data: recs } = await sb.from("broadcast_recipients").select("broadcast_id, status").in("broadcast_id", list.map((b) => b.id));
    for (const b of list) {
      b.stats = {};
      for (const r of recs ?? []) if (r.broadcast_id === b.id) b.stats[r.status] = (b.stats[r.status] ?? 0) + 1;
    }
    setPast(list);
  }, [sb]);

  useEffect(() => {
    load();
    sb.from("templates").select("*").eq("status", "APPROVED").order("name").then(({ data }) => setTemplates((data ?? []) as Template[]));
    sb.from("companies").select("settings").single().then(({ data }) => setRates(data?.settings?.meta_rates_rm ?? {}));
    sb.from("contact_overview").select("destination").not("destination", "is", null).limit(1000).then(({ data }) =>
      setDestinations([...new Set((data ?? []).map((d) => d.destination as string))].sort()));
    if (params.get("from") === "contacts") {
      try { setContactIds(JSON.parse(sessionStorage.getItem("broadcast_contacts") ?? "[]")); } catch { /* ignore */ }
    }
  }, [sb, load, params]);

  const segment = useMemo(() => ({
    stages: seg.stages, destinations: seg.destinations, label_ids: seg.label_ids,
    ...(seg.last_chat_days ? { last_chat_days: Number(seg.last_chat_days) } : {}), ...(contactIds.length ? { contact_ids: contactIds } : {}),
  }), [seg, contactIds]);

  useEffect(() => {
    const t = setTimeout(() => {
      sb.rpc("rpc_segment_count", { p_segment: segment }).then(({ data }) => setCount(data));
    }, 250);
    return () => clearTimeout(t);
  }, [segment, sb]);

  const tpl = templates.find((t) => t.name === tplName);
  useEffect(() => {
    if (!tpl) return;
    const n = templateVarCount(tpl);
    const m: Mapping = {};
    for (let i = 1; i <= n; i++) m[String(i)] = i === 1 ? { source: "contact.name", fallback: "Cik" } : { source: "static", value: "" };
    setMapping(m);
  }, [tpl]);

  const preview = tpl ? templateBody(tpl).replace(/\{\{(\d+)\}\}/g, (_m, n) => {
    const v = mapping[n];
    return v?.source === "contact.name" ? "Puan Aisyah" : v?.value || `{{${n}}}`;
  }) : "";
  const buttons: string[] = tpl ? ((tpl.components.find((c: any) => c.type === "BUTTONS")?.buttons ?? []) as any[]).map((b) => b.text) : [];
  const cost = count && tpl ? count.recipients * (rates[tpl.category] ?? 0) : null;

  async function save(status: "draft" | "scheduled" | "sending") {
    setMsg("");
    if (!name.trim() || !tpl) return setMsg("Give the broadcast a name and choose a template.");
    if (Object.values(mapping).some((m) => m.source === "static" && !m.value?.trim())) return setMsg("Fill in every template variable.");
    if (status === "scheduled" && !at) return setMsg("Choose a date and time.");
    const { data, error } = await sb.from("broadcasts").insert({
      company_id: me.company_id, name: name.trim(), template_name: tpl.name, template_language: tpl.language, variable_mapping: mapping,
      segment, status: status === "sending" ? "scheduled" : status, scheduled_at: status === "draft" ? null : status === "sending" ? new Date().toISOString() : new Date(at).toISOString(),
      handover_agent_id: handover || null, estimated_cost: cost, created_by: me.member_id,
    }).select("id").single();
    if (error) return setMsg(error.message);
    setMsg(status === "draft" ? "Draft saved." : status === "sending" ? "Sending now in batches (quiet hours 22:00–08:00 and Friday 12:30–14:30 are skipped)." : `Scheduled for ${fmtDate(at)} ${fmtTime(at)}.`);
    sessionStorage.removeItem("broadcast_contacts");
    setContactIds([]);
    load();
    return data;
  }

  async function sendTest() {
    setMsg("");
    if (!tpl) return setMsg("Choose a template first.");
    const { data: conv, error } = await sb.rpc("rpc_test_conversation");
    if (error) return setMsg(error.message === "set_your_phone" ? "Add your WhatsApp number in Settings › Staff & teams first." : error.message);
    const params = Object.keys(mapping).sort((a, b) => Number(a) - Number(b)).map((k) => mapping[k].source === "contact.name" ? me.display_name : mapping[k].value ?? "");
    try {
      await callFunction("wa-send", { conversation_id: conv, kind: "template", sender_type: "staff", template: { name: tpl.name, language: tpl.language, params } });
      setMsg("Test sent to your number.");
    } catch (e) { setMsg((e as Error).message); }
  }

  async function cancel(b: Broadcast) {
    await sb.from("broadcasts").update({ status: "cancelled" }).eq("id", b.id);
    load();
  }

  if (!dir) return null;
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="1 · Who receives" description="Only contacts who opted in. Anyone who replied STOP is excluded automatically." />
            <div className="flex flex-col gap-4 p-5 text-sm">
              {contactIds.length ? <p className="rounded-lg bg-brand-tint px-3 py-2">{contactIds.length} contacts picked on the Contacts page. <button type="button" className="font-semibold text-brand" onClick={() => setContactIds([])}>Clear</button></p> : null}
              <fieldset><legend className="mb-2 text-[13px] font-semibold text-body">Stage</legend>
                <div className="flex flex-wrap gap-2">{STAGES.map((s) => (
                  <label key={s.key} className="flex items-center gap-1.5"><input type="checkbox" checked={seg.stages.includes(s.key)} onChange={() => setSeg({ ...seg, stages: toggle(seg.stages, s.key) })} />{s.label}</label>))}</div>
              </fieldset>
              <fieldset><legend className="mb-2 text-[13px] font-semibold text-body">Destination</legend>
                <div className="flex flex-wrap gap-2">{destinations.length ? destinations.map((d) => (
                  <label key={d} className="flex items-center gap-1.5"><input type="checkbox" checked={seg.destinations.includes(d)} onChange={() => setSeg({ ...seg, destinations: toggle(seg.destinations, d) })} />{d}</label>)) : <span className="text-muted">No destinations recorded yet</span>}</div>
              </fieldset>
              <fieldset><legend className="mb-2 text-[13px] font-semibold text-body">Labels</legend>
                <div className="flex flex-wrap gap-2">{dir.labels.map((l) => (
                  <label key={l.id} className="flex items-center gap-1.5"><input type="checkbox" checked={seg.label_ids.includes(l.id)} onChange={() => setSeg({ ...seg, label_ids: toggle(seg.label_ids, l.id) })} />{l.name}</label>))}</div>
              </fieldset>
              <Field label="Last chat within (days)" htmlFor="b-days"><Input id="b-days" type="number" min={1} className="max-w-40" value={seg.last_chat_days} onChange={(e) => setSeg({ ...seg, last_chat_days: e.target.value })} placeholder="Any time" /></Field>
              <p className="font-semibold">{count ? `${count.recipients.toLocaleString()} recipients` : "Counting…"}{count ? <span className="font-normal text-muted"> · {count.not_opted_in_or_opted_out} contacts excluded (no opt-in or opted out)</span> : null}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="2 · Template" />
            <div className="flex flex-col gap-4 p-5 text-sm">
              <Field label="Broadcast name" htmlFor="b-name"><Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="KK Kundasang Mac 2027 hampir penuh" /></Field>
              <Field label="Approved template" htmlFor="b-tpl">
                <Select id="b-tpl" value={tplName} onChange={(e) => setTplName(e.target.value)}>
                  <option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.name}>{t.name} ({t.category})</option>)}
                </Select>
              </Field>
              {Object.entries(mapping).map(([k, m]) => (
                <div key={k} className="grid grid-cols-[160px_1fr] items-end gap-2">
                  <Field label={`Variable ${k}`} htmlFor={`bm-${k}`}>
                    <Select id={`bm-${k}`} value={m.source} onChange={(e) => setMapping({ ...mapping, [k]: { ...m, source: e.target.value as "contact.name" | "static" } })}>
                      <option value="contact.name">Customer name</option><option value="static">Fixed text</option>
                    </Select>
                  </Field>
                  <Input aria-label={`Variable ${k} value`} value={m.source === "static" ? m.value ?? "" : m.fallback ?? ""}
                    placeholder={m.source === "static" ? "Text for everyone" : "If the name is missing"}
                    onChange={(e) => setMapping({ ...mapping, [k]: m.source === "static" ? { ...m, value: e.target.value } : { ...m, fallback: e.target.value } })} />
                </div>
              ))}
              <Field label="When the customer replies, hand over to" htmlFor="b-agent">
                <Select id="b-agent" value={handover} onChange={(e) => setHandover(e.target.value)}>
                  <option value="">Normal routing</option>{dir.agents.map((a) => <option key={a.id} value={a.id}>{a.name} (AI){a.description ? ` · ${a.description}` : ""}</option>)}
                </Select>
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="3 · When" />
            <div className="flex flex-col gap-3 p-5 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Send now</label>
              <label className="flex items-center gap-2"><input type="radio" name="when" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> Schedule</label>
              {when === "schedule" ? <Field label="Date and time" htmlFor="b7"><Input id="b7" type="datetime-local" className="max-w-64" value={at} onChange={(e) => setAt(e.target.value)} /></Field> : null}
              <p className="text-muted">Customers who reply &ldquo;STOP&rdquo; or tap &ldquo;Jangan hantar lagi&rdquo; are removed from all broadcasts. Sent in batches to keep the number&apos;s quality high; nothing goes out 22:00–08:00 or Friday 12:30–14:30.</p>
              {msg ? <p role="status" className="rounded-lg bg-panel px-3 py-2">{msg}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={sendTest}>Send test to my number</Button>
                <Button variant="secondary" onClick={() => save("draft")}>Save draft</Button>
                {admin ? <Button onClick={() => save(when === "now" ? "sending" : "scheduled")}>{when === "now" ? "Send now" : "Schedule"}</Button> : null}
              </div>
              {!admin ? <p className="text-xs text-muted">Team leads can prepare drafts; an admin sends them.</p> : null}
            </div>
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Preview" />
            <div className="flex flex-col gap-3 p-5">
              <div className="rounded-lg bg-chat-bg p-3">
                <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm">{preview || "Choose a template"}</p>
                {buttons.map((b) => <p key={b} className="mt-1 rounded-lg bg-white py-2 text-center text-sm font-semibold text-info">{b}</p>)}
              </div>
              <p className="text-sm">Estimated Meta cost: <strong>{cost !== null ? rm(Math.round(cost * 100) / 100) : "–"}</strong>
                {tpl ? <span className="text-muted"> ({count?.recipients ?? 0} × {rm(rates[tpl.category] ?? 0)} {tpl.category.toLowerCase()})</span> : null}</p>
            </div>
          </Card>
        </aside>
      </div>
      <Card className="overflow-x-auto">
        <CardHeader title="Past broadcasts" />
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted">
            <tr><th className="px-4 py-3">Name</th><th className="px-3 py-3">Template</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">When</th><th className="px-3 py-3">Sent</th><th className="px-3 py-3">Read</th><th className="px-3 py-3">Replied</th><th className="px-3 py-3">Failed</th><th className="px-3 py-3" /></tr>
          </thead>
          <tbody>
            {past.map((b) => {
              const s = b.stats ?? {};
              const sent = (s.sent ?? 0) + (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0);
              return (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">{b.name}</td><td className="px-3 py-3">{b.template_name}</td>
                  <td className="px-3 py-3"><Badge tone={b.status === "sent" ? "success" : b.status === "sending" ? "warn" : "neutral"}>{b.status}</Badge></td>
                  <td className="px-3 py-3 text-muted">{fmtDate(b.started_at ?? b.scheduled_at ?? b.created_at)}</td>
                  <td className="px-3 py-3">{sent}</td><td className="px-3 py-3">{(s.read ?? 0) + (s.replied ?? 0)}</td>
                  <td className="px-3 py-3">{s.replied ?? 0}</td><td className="px-3 py-3">{s.failed ?? 0}</td>
                  <td className="px-3 py-3">{admin && ["draft", "scheduled"].includes(b.status) ? <Button size="sm" variant="ghost" onClick={() => cancel(b)}>Cancel</Button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
