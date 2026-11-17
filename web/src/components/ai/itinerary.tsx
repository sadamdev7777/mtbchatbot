"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function ItineraryUpload() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const sb = supabaseBrowser();
  const [agents, setAgents] = useState<{ id: string; name: string; travelboost_product_ids: string[] }[]>([]);
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  const [product, setProduct] = useState("");
  const [dates, setDates] = useState<"all" | "specific">("all");
  const [dateList, setDateList] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { sb.from("agents").select("id, name, travelboost_product_ids").order("name").then(({ data }) => setAgents(data ?? [])); }, [sb]);
  const agent = agents.find((a) => a.id === agentId);
  useEffect(() => { if (agent && !product) setProduct(agent.travelboost_product_ids[0] ?? ""); }, [agent, product]);

  async function upload() {
    if (!file || !agentId || !product) return setError("Choose the agent, the TravelBoost product and a file.");
    setError("");
    setBusy("Uploading…");
    const path = `${me.company_id}/itineraries/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: up } = await sb.storage.from("media").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up) { setBusy(""); return setError(up.message); }
    const applies = dates === "all" ? "all" : dateList.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);
    const { data, error: e } = await sb.from("itineraries").insert({ company_id: me.company_id, agent_id: agentId, travelboost_product_id: product, applies_to: applies, file_path: path, file_name: file.name, uploaded_by: me.member_id }).select("id").single();
    if (e) { setBusy(""); return setError(e.message); }
    setBusy("Claude is reading the itinerary…");
    try { await callFunction("itinerary-extract", { action: "extract", itinerary_id: data.id }); } catch (err) { setError((err as Error).message); }
    router.push(`/ai/itinerary/${data.id}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 md:p-8">
      <p className="text-sm text-muted"><Link href="/ai">AI Team</Link>{agent ? <> / <Link href={`/ai/agents/${agent.id}`}>{agent.name}</Link></> : null} / Upload itinerary</p>
      <h1 className="text-2xl font-bold">Upload itinerary</h1>
      <Card className="flex flex-col gap-4 p-5">
        <Field label="Agent" htmlFor="it-agent"><Select id="it-agent" value={agentId} onChange={(e) => { setAgentId(e.target.value); setProduct(""); }}>
          <option value="">Choose…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="TravelBoost product" htmlFor="it-prod"><Input id="it-prod" list="it-products" value={product} onChange={(e) => setProduct(e.target.value)} />
          <datalist id="it-products">{agent?.travelboost_product_ids.map((p) => <option key={p} value={p} />)}</datalist></Field>
        <fieldset className="flex flex-col gap-2 text-sm"><legend className="mb-1 text-[13px] font-semibold text-body">Applies to</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={dates === "all"} onChange={() => setDates("all")} /> All dates of this product</label>
          <label className="flex items-center gap-2"><input type="radio" checked={dates === "specific"} onChange={() => setDates("specific")} /> Specific departure dates</label>
          {dates === "specific" ? <Input aria-label="Departure dates" placeholder="2027-03-04, 2027-03-11" value={dateList} onChange={(e) => setDateList(e.target.value)} /> : null}
        </fieldset>
        <Field label="File (PDF, Word or image)" htmlFor="it-file" hint="Claude reads it and organises it by day. Prices and seat counts in the file are ignored: they always come live from TravelBoost.">
          <input id="it-file" type="file" accept=".pdf,.docx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div><Button onClick={upload} disabled={!!busy}>{busy || "Upload and read"}</Button></div>
      </Card>
    </div>
  );
}

interface Q { id: string; question: string; why: string | null; options: string[]; answer: string | null; assigned_member_id: string | null }

export function ItineraryReview({ id }: { id: string }) {
  const dir = useDirectory();
  const sb = supabaseBrowser();
  const [it, setIt] = useState<any>(null);
  const [qs, setQs] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [assignee, setAssignee] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("itineraries").select("*, agent:agents(id, name)").eq("id", id).single();
    setIt(data);
    const { data: q } = await sb.from("itinerary_questions").select("*").eq("itinerary_id", id).order("created_at");
    setQs((q ?? []) as Q[]);
    setAnswers(Object.fromEntries((q ?? []).map((x) => [x.id, x.answer ?? ""])));
    if (data?.file_path) sb.storage.from("media").createSignedUrl(data.file_path, 3600).then(({ data: u }) => setFileUrl(u?.signedUrl ?? null));
  }, [sb, id]);
  useEffect(() => { load(); }, [load]);

  async function saveAll() {
    setBusy(true);
    for (const q of qs) if ((answers[q.id] ?? "") !== (q.answer ?? "")) await sb.from("itinerary_questions").update({ answer: answers[q.id] || null }).eq("id", q.id);
    setBusy(false);
    setMsg({ ok: true, text: "Answers saved." });
    load();
  }
  async function sendTo() {
    if (!assignee) return;
    const { data, error } = await sb.rpc("rpc_assign_itinerary_questions", { p_itinerary: id, p_member: assignee, p_question_ids: null });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: `${data} question(s) sent. They appear in that person's notifications.` });
    load();
  }
  async function activate() {
    await saveAll();
    setBusy(true);
    setMsg({ ok: true, text: "Running the agent's test scenarios with this itinerary…" });
    try {
      const r = await callFunction<{ scenarios: { passed: number; total: number } }>("itinerary-extract", { action: "activate", itinerary_id: id });
      setMsg({ ok: true, text: `Activated for the bot. Scenarios ${r.scenarios.passed}/${r.scenarios.total} passed.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
    load();
  }
  async function reExtract() {
    setBusy(true);
    try { await callFunction("itinerary-extract", { action: "extract", itinerary_id: id }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
    load();
  }

  if (!it || !dir) return <div className="p-8 text-sm text-muted">Loading…</div>;
  const answered = qs.filter((q) => (answers[q.id] ?? "").trim()).length;
  const ex = it.extracted ?? { days: [] };
  const steps = ["Upload", "Claude reads", `Answer questions (${answered}/${qs.length})`, "Review & activate"];
  const stepIdx = it.status === "active" ? 4 : it.status === "extracting" ? 1 : answered < qs.length ? 2 : 3;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted"><Link href="/ai">AI Team</Link> / <Link href={`/ai/agents/${it.agent.id}`}>{it.agent.name}</Link> / Itinerary</p>
          <h1 className="text-2xl font-bold">{it.file_name ?? "Itinerary"}</h1>
          <p className="text-sm text-muted">Linked to TravelBoost product {it.travelboost_product_id} · {it.applies_to === "all" ? "all dates" : `${it.applies_to.length} dates`} · status <strong>{it.status.replace("_", " ")}</strong></p>
        </div>
        <Button onClick={activate} disabled={busy || it.status === "active" || it.status === "extracting" || answered < qs.length}>Activate for bot</Button>
      </header>
      <ol aria-label="Steps" className="flex flex-wrap gap-2 text-sm">
        {steps.map((s, i) => <li key={s} className={cn("rounded-full px-3 py-1", i < stepIdx ? "bg-success-soft text-success" : i === stepIdx ? "bg-brand text-white" : "bg-chip text-muted")}>{i + 1} · {s}</li>)}
      </ol>
      {msg ? <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}
      {it.status === "failed" ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">Reading failed: {it.error_text} <Button size="sm" variant="secondary" onClick={reExtract}>Try again</Button></p> : null}
      {qs.length ? (
        <Card>
          <CardHeader title={`Claude needs your answer on ${qs.length} items`} description="Everything is collected here so you can answer in one go. The bot won't use this itinerary until it's complete." />
          <ul className="divide-y divide-line">
            {qs.map((q) => (
              <li key={q.id} className="flex flex-col gap-2 px-5 py-4">
                <p className="font-semibold">{q.question}</p>
                {q.why ? <p className="text-sm text-muted">{q.why}</p> : null}
                <div role="group" aria-label={q.question} className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <button key={o} type="button" aria-pressed={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}
                      className={cn("min-h-10 rounded-lg border px-3 text-sm", answers[q.id] === o ? "border-brand bg-brand-tint font-semibold" : "border-input bg-white")}>{o}</button>
                  ))}
                </div>
                <Input aria-label={`Other answer for: ${q.question}`} placeholder="Or type the answer" value={q.options.includes(answers[q.id] ?? "") ? "" : answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                {q.assigned_member_id ? <p className="text-xs text-muted">Sent to {dir.member(q.assigned_member_id)?.display_name}</p> : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 border-t border-line p-5">
            <Button onClick={saveAll} disabled={busy}>Save all answers</Button>
            <Select aria-label="Send to staff" className="w-48" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Send questions to…</option>{dir.members.filter((m) => m.status === "active" && m.role !== "accounts").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </Select>
            <Button variant="secondary" onClick={sendTo} disabled={!assignee}>Send questions to another staff member</Button>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Original file" />
          <div className="p-5 text-sm">{fileUrl ? (it.file_path.endsWith(".pdf") ? <iframe title="Original itinerary" src={fileUrl} className="h-[480px] w-full rounded-lg border border-line" /> : <a href={fileUrl} target="_blank" rel="noreferrer">Open the file</a>) : "–"}</div>
        </Card>
        <Card>
          <CardHeader title="What Claude understood" />
          <ul className="divide-y divide-line">
            {ex.days.map((d: any) => (
              <li key={d.day} className="px-5 py-3 text-sm">
                <p className="font-semibold">Day {d.day} · {d.route}</p>
                <p><span className="text-muted">Activities:</span> {d.activities.join(", ")}</p>
                {d.meals?.length ? <p><span className="text-muted">Meals:</span> {d.meals.join(", ")}</p> : null}
                {d.hotel ? <p><span className="text-muted">Hotel:</span> {d.hotel}</p> : null}
              </li>
            ))}
            {ex.included?.length ? <li className="px-5 py-3 text-sm"><span className="text-muted">Included:</span> {ex.included.join(", ")}</li> : null}
            {ex.not_included?.length ? <li className="px-5 py-3 text-sm"><span className="text-muted">Not included:</span> {ex.not_included.join(", ")}</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Questions assigned to me (any role that can be assigned). */
export function MyQuestions() {
  const sb = supabaseBrowser();
  const me = useMe();
  const [qs, setQs] = useState<(Q & { itinerary_id: string })[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const { data } = await sb.from("itinerary_questions").select("*").eq("assigned_member_id", me.member_id).is("answer", null).order("created_at");
    setQs((data ?? []) as never);
  }, [sb, me.member_id]);
  useEffect(() => { load(); }, [load]);
  async function save(q: Q) {
    const { error } = await sb.from("itinerary_questions").update({ answer: answers[q.id], answered_by: me.member_id }).eq("id", q.id);
    setMsg(error ? error.message : "Answer saved.");
    load();
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-8">
      <h1 className="text-2xl font-bold">Questions for you</h1>
      <p className="text-sm text-muted">Itinerary questions an admin sent you. Your answers teach the AI agents.</p>
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      {qs.length === 0 ? <Card className="p-6 text-center text-sm text-muted">No questions waiting.</Card> : null}
      {qs.map((q) => (
        <Card key={q.id} className="flex flex-col gap-2 p-5">
          <p className="font-semibold">{q.question}</p>{q.why ? <p className="text-sm text-muted">{q.why}</p> : null}
          <div className="flex flex-wrap gap-2">{q.options.map((o) => <button key={o} type="button" aria-pressed={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}
            className={cn("min-h-11 rounded-lg border px-3 text-sm", answers[q.id] === o ? "border-brand bg-brand-tint font-semibold" : "border-input bg-white")}>{o}</button>)}</div>
          <Input aria-label="Your answer" placeholder="Or type the answer" value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
          <div><Button onClick={() => save(q)} disabled={!answers[q.id]?.trim()}>Save answer</Button></div>
        </Card>
      ))}
    </div>
  );
}
