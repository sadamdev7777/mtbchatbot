"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AiFrame } from "./common";

interface Saw { knowledge: string; knowledge_versions: Record<string, number>; official_answers: string[]; tools: { name: string; summary: string; ms: number }[]; rows_shown: number; reply_ms: number; labels: { name: string; reason: string }[]; model: string; cost_usd: number }
interface Turn { role: "customer" | "bot" | "tool" | "handover"; text: string }
interface ScenarioRun { name: string; passed: boolean; failures: string[] }

export function TestBot() {
  const params = useSearchParams();
  const sb = supabaseBrowser();
  const [agents, setAgents] = useState<{ id: string; name: string; status: string }[]>([]);
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  const [kind, setKind] = useState<"live" | "draft">("live");
  const [stage, setStage] = useState("lead");
  const [chat, setChat] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [saw, setSaw] = useState<Saw | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scenarios, setScenarios] = useState<{ id: string; name: string; customer_messages: string[] }[]>([]);
  const [results, setResults] = useState<Record<string, ScenarioRun>>({});
  const [running, setRunning] = useState(false);

  useEffect(() => {
    sb.from("agents").select("id, name, status").order("name").then(({ data }) => {
      setAgents(data ?? []);
      if (!agentId && data?.length) setAgentId(data[0].id);
    });
  }, [sb, agentId]);
  const loadScenarios = useCallback(async () => {
    if (!agentId) return;
    const { data } = await sb.from("test_scenarios").select("id, name, customer_messages").eq("enabled", true).or(`agent_id.is.null,agent_id.eq.${agentId}`).order("created_at");
    setScenarios(data ?? []);
    const { data: last } = await sb.from("test_runs").select("scenario_id, passed, details, batch_id, created_at").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(60);
    const r: Record<string, ScenarioRun> = {};
    for (const x of last ?? []) if (!r[x.scenario_id]) r[x.scenario_id] = { name: "", passed: x.passed, failures: x.details?.failures ?? [] };
    setResults(r);
  }, [sb, agentId]);
  useEffect(() => { loadScenarios(); setChat([]); setSaw(null); }, [loadScenarios]);

  async function send(msg?: string) {
    const t = (msg ?? text).trim();
    if (!t || !agentId) return;
    const history = [...chat, { role: "customer" as const, text: t }];
    setChat(history);
    setText("");
    setBusy(true);
    setError("");
    try {
      const r = await callFunction<{ replies: string[]; handover: { reason: string } | null; what_bot_saw: Saw }>("ai-orchestrator", {
        action: "sandbox", agent_id: agentId, knowledge: kind, stage,
        messages: history.filter((m) => m.role === "customer" || m.role === "bot").map((m) => ({ role: m.role, text: m.text })),
      });
      setSaw(r.what_bot_saw);
      setChat([...history, ...r.what_bot_saw.tools.map((x) => ({ role: "tool" as const, text: `Tool: ${x.summary}` })), ...r.replies.map((x) => ({ role: "bot" as const, text: x })),
        ...(r.handover ? [{ role: "handover" as const, text: `Handover to staff · ${r.handover.reason}` }] : [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    setRunning(true);
    setError("");
    try {
      const r = await callFunction<{ passed: number; total: number; results: { scenario_id: string; name: string; passed: boolean; failures: string[] }[] }>("ai-orchestrator", { action: "run_scenarios", agent_id: agentId, knowledge: kind });
      setResults(Object.fromEntries(r.results.map((x) => [x.scenario_id, x])));
    } catch (e) { setError((e as Error).message); }
    setRunning(false);
  }

  return (
    <AiFrame title="Test bot" description="Chat as a customer. Nothing is sent to real WhatsApp and no seats are locked.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Agent<Select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-48">{agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.status})</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Knowledge<Select value={kind} onChange={(e) => setKind(e.target.value as "live" | "draft")} className="w-40"><option value="live">Live version</option><option value="draft">Draft version</option></Select></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Customer stage<Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-40"><option value="lead">Lead</option><option value="deposit">Deposit</option></Select></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">Scenario<Select value="" onChange={(e) => { const s = scenarios.find((x) => x.id === e.target.value); if (s) { setChat([]); send(s.customer_messages[0]); } }} className="w-64">
          <option value="">Start from a scenario…</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
        <Button variant="secondary" onClick={() => { setChat([]); setSaw(null); }}>Reset chat</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <section aria-label="Test chat" className="flex min-h-[520px] flex-col rounded-xl border border-line bg-chat-bg">
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
            {chat.length === 0 ? <p className="m-auto text-sm text-muted">Type a message like a customer would.</p> : null}
            {chat.map((m, i) => (
              m.role === "tool" ? <p key={i} className="self-end text-[11px] text-muted">{m.text}</p>
              : m.role === "handover" ? <p key={i} className="self-center rounded-lg bg-note px-3 py-2 text-[13px] text-warn-ink">{m.text}</p>
              : <p key={i} className={cn("max-w-[75%] whitespace-pre-wrap rounded-[10px] px-3 py-2 text-sm", m.role === "customer" ? "self-start bg-white" : "self-end bg-bubble-out")}>{m.text}</p>
            ))}
            {busy ? <p className="self-end text-xs text-muted">Bot is typing…</p> : null}
          </div>
          <form className="flex gap-2 border-t border-line bg-white p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label htmlFor="u3" className="sr-only">Test message</label>
            <Input id="u3" placeholder="Type like a customer…" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" disabled={busy || !text.trim()}>Send</Button>
          </form>
        </section>
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="What the bot saw (last message)" />
            {saw ? (
              <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 p-5 text-sm">
                <dt className="text-muted">Knowledge</dt><dd>{saw.knowledge} · {Object.entries(saw.knowledge_versions).map(([k, v]) => `${k} v${v}`).join(", ")}</dd>
                <dt className="text-muted">Official answers</dt><dd>{saw.official_answers.length ? saw.official_answers.join("; ") : "None matched"}</dd>
                <dt className="text-muted">Tools called</dt><dd>{saw.tools.length ? saw.tools.map((t) => t.summary).join("; ") : "None"}</dd>
                <dt className="text-muted">Dates shown</dt><dd>{saw.rows_shown} (max 8)</dd>
                <dt className="text-muted">Reply time</dt><dd>{(saw.reply_ms / 1000).toFixed(1)} seconds</dd>
                <dt className="text-muted">Handover</dt><dd>{chat.some((c) => c.role === "handover") ? "Yes" : "Not needed"}</dd>
                <dt className="text-muted">Labels</dt><dd>{saw.labels.map((l) => l.name).join(", ") || "–"}</dd>
                <dt className="text-muted">Model · cost</dt><dd>{saw.model} · ${saw.cost_usd.toFixed(4)}</dd>
              </dl>
            ) : <p className="p-5 text-sm text-muted">Send a message to see what the bot used.</p>}
          </Card>
          <Card>
            <CardHeader title="Saved test scenarios" description="Run all before activating a new knowledge version." action={<Button size="sm" onClick={runAll} disabled={running || !agentId}>{running ? "Running…" : "Run all tests"}</Button>} />
            <ul className="max-h-96 divide-y divide-line overflow-y-auto" tabIndex={0} aria-label="Scenario results">
              {scenarios.map((s) => {
                const r = results[s.id];
                return (
                  <li key={s.id} className="px-5 py-2.5 text-sm">
                    <div className="flex justify-between gap-2"><span>{s.name}</span>
                      <span className={r ? (r.passed ? "font-semibold text-success" : "font-semibold text-danger") : "text-muted"}>{r ? (r.passed ? "Pass" : "Fail") : "–"}</span></div>
                    {r && !r.passed ? <p className="text-xs text-danger">{r.failures.join("; ")}</p> : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>
      </div>
    </AiFrame>
  );
}
