"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./common";

const STEPS = ["Package", "Name & avatar", "Knowledge", "Test", "Approve"];
const COLOURS = ["#0E7C66", "#5B4BC4", "#B54708", "#175CD3", "#B42318", "#067647"];

export function NewAgentWizard() {
  const me = useMe();
  const dir = useDirectory();
  const params = useSearchParams();
  const router = useRouter();
  const sb = supabaseBrowser();
  const [agentId, setAgentId] = useState<string | null>(params.get("agent"));
  const [step, setStep] = useState(Number(params.get("step") ?? (params.get("agent") ? 2 : 0)));
  const [pkg, setPkg] = useState({ products: "", destination: "", team: "", keywords: "" });
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [look, setLook] = useState({ name: "", colour: COLOURS[0], staff: "" });
  const [knowledge, setKnowledge] = useState("");
  const [pastChats, setPastChats] = useState("");
  const [drafts, setDrafts] = useState<{ id: string; question: string; answer: string }[]>([]);
  const [itins, setItins] = useState<{ id: string; file_name: string | null; status: string }[]>([]);
  const [tests, setTests] = useState<{ passed: number; total: number; results: { name: string; passed: boolean; failures: string[] }[] } | null>(null);
  const [mode, setMode] = useState("assist");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const loadAgent = useCallback(async () => {
    if (!agentId) return;
    const { data: a } = await sb.from("agents").select("*").eq("id", agentId).single();
    if (a) {
      setPkg({ products: a.travelboost_product_ids.join(", "), destination: a.destination ?? "", team: a.team_id ?? "", keywords: a.destination_keywords.join(", ") });
      setLook({ name: a.name, colour: a.avatar_color, staff: a.default_staff_member_id ?? "" });
    }
    const { data: k } = await sb.from("knowledge_docs").select("content").eq("agent_id", agentId).eq("section", "package").order("version", { ascending: false }).limit(1).maybeSingle();
    if (k) setKnowledge(k.content);
    const { data: d } = await sb.from("official_answers").select("id, question, answer").eq("agent_id", agentId).eq("status", "draft");
    setDrafts(d ?? []);
    const { data: it } = await sb.from("itineraries").select("id, file_name, status").eq("agent_id", agentId);
    setItins(it ?? []);
    const { data: last } = await sb.from("test_runs").select("batch_id").eq("agent_id", agentId).eq("context", "go_live").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last) {
      const { data: runs } = await sb.from("test_runs").select("passed, details, scenario:test_scenarios(name)").eq("batch_id", last.batch_id);
      setTests({ passed: (runs ?? []).filter((r) => r.passed).length, total: runs?.length ?? 0,
        results: (runs ?? []).map((r: any) => ({ name: r.scenario?.name ?? "", passed: r.passed, failures: r.details?.failures ?? [] })) });
    }
  }, [sb, agentId]);
  useEffect(() => { loadAgent(); }, [loadAgent]);
  useEffect(() => { router.replace(`/ai/new?${agentId ? `agent=${agentId}&` : ""}step=${step}`, { scroll: false }); }, [step, agentId, router]);

  async function checkProducts() {
    const ids = pkg.products.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return setCheck({ ok: false, text: "Enter at least one TravelBoost product ID." });
    try {
      const r = await callFunction<{ product: { name: string; destination: string } | null; dates_next_month: number; mode: string }>("tb-webhook", { action: "product", product_id: ids[0] });
      if (!r.product) return setCheck({ ok: false, text: `TravelBoost has no product ${ids[0]}.` });
      setCheck({ ok: true, text: `${r.product.name} · ${r.dates_next_month} departures next month${r.mode === "mock" ? " (mock data)" : ""}` });
      if (!pkg.destination) setPkg((p) => ({ ...p, destination: r.product!.destination }));
    } catch (e) { setCheck({ ok: false, text: (e as Error).message }); }
  }

  async function saveLook() {
    const row = {
      company_id: me.company_id, name: look.name.trim(), avatar_color: look.colour, default_staff_member_id: look.staff || null, team_id: pkg.team || null,
      destination: pkg.destination, description: pkg.destination, travelboost_product_ids: pkg.products.split(",").map((s) => s.trim()).filter(Boolean),
      destination_keywords: pkg.keywords.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean), mode: "assist", status: "training",
      persona: `${look.name.trim()} ialah pembantu AI Muslimtravelbug untuk pakej ${pkg.destination}. Mesra, ringkas dan jelas.`,
    };
    if (agentId) await sb.from("agents").update(row).eq("id", agentId);
    else {
      const { data, error } = await sb.from("agents").insert(row).select("id").single();
      if (error) return setMsg(error.code === "23505" ? "An agent with this name exists." : error.message);
      setAgentId(data.id);
    }
    setStep(2);
  }

  async function saveKnowledge() {
    if (!agentId || !knowledge.trim()) return;
    setBusy("Saving…");
    const { data: id } = await sb.rpc("rpc_save_knowledge", { p_scope: "agent", p_agent: agentId, p_section: "package", p_content: knowledge });
    if (id) await sb.rpc("rpc_activate_knowledge", { p_doc: id }); // training agent: nothing customer-facing yet
    if (pastChats.trim()) {
      const r = await callFunction<{ drafts: number }>("itinerary-extract", { action: "past_chats", agent_id: agentId, text: pastChats });
      setMsg(`${r.drafts} question(s) found in past chats. Approve them below.`);
    }
    setBusy("");
    loadAgent();
  }

  async function runTests() {
    if (!agentId) return;
    setBusy("Generating 25 scenarios…");
    try {
      await callFunction("itinerary-extract", { action: "generate_scenarios", agent_id: agentId });
      setBusy("Running 25 scenarios…");
      const r = await callFunction<{ passed: number; total: number; results: { name: string; passed: boolean; failures: string[] }[] }>("ai-orchestrator", { action: "run_scenarios", agent_id: agentId, context: "go_live" });
      setTests(r);
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  }

  async function approve() {
    const { error } = await sb.rpc("rpc_approve_agent", { p_agent: agentId, p_mode: mode });
    if (error) return setMsg(error.message.startsWith("needs_25") ? `Tests must pass 25/25 first (${error.message.replace("needs_25_of_25 ", "")}).` : error.message === "only_owner_approves_go_live" ? "Only the owner can approve going live." : error.message);
    router.push(`/ai/agents/${agentId}`);
  }

  if (!dir) return null;
  const allPass = !!tests && tests.total >= 25 && tests.passed === tests.total;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-8">
      <header>
        <p className="text-sm text-muted"><Link href="/ai">AI Team</Link> / New agent</p>
        <h1 className="text-2xl font-bold">{look.name ? `New agent: ${look.name}` : "Hire a new agent"}{pkg.destination ? ` for ${pkg.destination}` : ""}</h1>
        <ol aria-label="Steps" className="mt-3 flex flex-wrap gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s}><button type="button" disabled={i > 0 && !agentId && i !== 1} onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
              className={cn("rounded-full px-3 py-1", i === step ? "bg-brand text-white" : i < step ? "bg-success-soft text-success" : "bg-chip text-muted")}>{i + 1} · {s}</button></li>
          ))}
        </ol>
      </header>
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
      <Card className="flex flex-col gap-4 p-5">
        {step === 0 ? (
          <>
            <h2 className="font-semibold">Which package will this agent handle?</h2>
            <p className="text-sm text-muted">Pick products from TravelBoost. Dates, prices and seats are pulled straight from there.</p>
            <Field label="TravelBoost product IDs" htmlFor="w-prod"><div className="flex gap-2"><Input id="w-prod" placeholder="tb-semporna" value={pkg.products} onChange={(e) => setPkg({ ...pkg, products: e.target.value })} /><Button variant="secondary" onClick={checkProducts}>Check</Button></div></Field>
            {check ? <p className={check.ok ? "text-sm text-success" : "text-sm text-danger"}>{check.text}</p> : null}
            <Field label="Destination name" htmlFor="w-dest"><Input id="w-dest" value={pkg.destination} onChange={(e) => setPkg({ ...pkg, destination: e.target.value })} /></Field>
            <Field label="Router keywords" htmlFor="w-kw" hint="Comma separated, e.g. semporna, mabul, sipadan"><Input id="w-kw" value={pkg.keywords} onChange={(e) => setPkg({ ...pkg, keywords: e.target.value })} /></Field>
            <Field label="Hands over to team" htmlFor="w-team"><Select id="w-team" value={pkg.team} onChange={(e) => setPkg({ ...pkg, team: e.target.value })}><option value="">Choose…</option>{dir.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h2 className="font-semibold">Name and look (internal)</h2>
            <p className="text-sm text-muted">This name helps staff recognise the agent. Customers see &ldquo;Pembantu AI · staff name&rdquo;.</p>
            <Field label="Agent name" htmlFor="an"><Input id="an" value={look.name} onChange={(e) => setLook({ ...look, name: e.target.value })} /></Field>
            <div role="radiogroup" aria-label="Choose avatar colour" className="flex gap-3">
              {COLOURS.map((c) => <button key={c} type="button" role="radio" aria-checked={look.colour === c} aria-label={`Colour ${c}`} onClick={() => setLook({ ...look, colour: c })}
                className={cn("rounded-full p-0.5", look.colour === c ? "ring-2 ring-brand ring-offset-2" : "")}><AgentAvatar name={look.name || "?"} colour={c} size={44} /></button>)}
            </div>
            <Field label="Staff name shown to customers by default" htmlFor="w-staff"><Select id="w-staff" value={look.staff} onChange={(e) => setLook({ ...look, staff: e.target.value })}>
              <option value="">Muslimtravelbug</option>{dir.members.filter((m) => m.status === "active" && m.role !== "accounts").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
            <p className="text-xs text-muted">Language style is inherited from Company knowledge.</p>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2 className="font-semibold">Teach the agent about the package</h2>
            <Field label="Package knowledge (inclusions, hotels, rules — never prices or seats)" htmlFor="w-know"><Textarea id="w-know" rows={8} value={knowledge} onChange={(e) => setKnowledge(e.target.value)} /></Field>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link href={`/ai/itinerary/new?agent=${agentId}`} className="font-semibold">Upload itinerary (PDF, Word or images)</Link>
              {itins.map((i) => <Link key={i.id} href={`/ai/itinerary/${i.id}`} className="rounded-full bg-chip px-2 py-0.5 text-xs">{i.file_name} · {i.status.replace("_", " ")}</Link>)}
            </div>
            <Field label="Import past chats (optional)" htmlFor="w-past" hint="Paste past CS chats; Claude extracts common questions and the staff answers as official-answer drafts for you to approve.">
              <Textarea id="w-past" rows={4} value={pastChats} onChange={(e) => setPastChats(e.target.value)} />
            </Field>
            <div><Button onClick={saveKnowledge} disabled={!!busy || !knowledge.trim()}>{busy || "Save knowledge"}</Button></div>
            {drafts.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                    <span><strong>{d.question}</strong><br />{d.answer}</span>
                    <span className="flex gap-1"><Button size="sm" onClick={async () => { await sb.from("official_answers").update({ status: "active" }).eq("id", d.id); loadAgent(); }}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={async () => { await sb.from("official_answers").update({ status: "archived" }).eq("id", d.id); loadAgent(); }}>Reject</Button></span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <>
            <h2 className="font-semibold">Test before going live</h2>
            <p className="text-sm text-muted">Claude generates 15 scenarios from the knowledge, plus the 10 company scenarios: 25 in total. All must pass.</p>
            <div><Button onClick={runTests} disabled={!!busy}>{busy || (tests ? "Run the 25 tests again" : "Generate and run 25 tests")}</Button></div>
            {tests ? (
              <>
                <p className={allPass ? "font-semibold text-success" : "font-semibold text-danger"}>{tests.passed}/{tests.total} passed</p>
                <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
                  {tests.results.map((r, i) => <li key={i} className="flex justify-between gap-3 px-3 py-2"><span>{r.name}{!r.passed ? <span className="block text-xs text-danger">{r.failures.join("; ")}</span> : null}</span>
                    <span className={r.passed ? "text-success" : "text-danger"}>{r.passed ? "Pass" : "Fail"}</span></li>)}
                </ul>
                <Link href={`/ai/test?agent=${agentId}`} className="text-sm font-semibold">Open the test bot</Link>
              </>
            ) : null}
          </>
        ) : null}
        {step === 4 ? (
          <>
            <h2 className="font-semibold">Approve to go live</h2>
            <ul className="text-sm">
              <li>{pkg.products ? "✓" : "✗"} TravelBoost products linked</li>
              <li>{itins.some((i) => i.status === "active") ? "✓ Itinerary active, all questions answered" : "○ No active itinerary yet (optional but recommended)"}</li>
              <li className={allPass ? "text-success" : "text-danger"}>{allPass ? "✓" : "✗"} Tests {tests ? `${tests.passed}/${tests.total}` : "not run"}: need 25/25 before going live</li>
            </ul>
            <Field label="Starting mode" htmlFor="w-mode"><Select id="w-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="assist">Assist (drafts only)</option><option value="follow_schedule">Follow schedule</option><option value="auto">Auto</option></Select></Field>
            <p className="text-sm text-muted">Only the owner can approve. Once live, the Router sends {pkg.destination || "this package's"} chats to this agent.</p>
            <div><Button onClick={approve} disabled={me.role !== "owner" || !allPass}>Approve and go live</Button></div>
          </>
        ) : null}
      </Card>
      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</Button>
        {step === 0 ? <Button onClick={() => setStep(1)} disabled={!pkg.products.trim() || !pkg.destination.trim()}>Next</Button> : null}
        {step === 1 ? <Button onClick={saveLook} disabled={!look.name.trim()}>Save and next</Button> : null}
        {step === 2 || step === 3 ? <Button onClick={() => setStep(step + 1)} disabled={!agentId}>Next</Button> : null}
      </div>
    </div>
  );
}
