"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, Empty, Stat } from "@/components/ui/misc";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/utils";

interface Report { id: string; report_date: string; summary: any; body: string | null; status: string; phases: Record<string, any> }
interface Sug { id: string; kind: string; title: string; payload: any; evidence: any[]; status: string; auto_applied: boolean; team_id: string | null }
const KIND_LABEL: Record<string, string> = { official_answer: "Official answer", rule: "Rule", knowledge: "Knowledge", style: "Language style", staff: "Staff & leads", label: "Label", question: "Question" };

export function MorningReport() {
  const me = useMe();
  const admin = isAdmin(me.role);
  const sb = supabaseBrowser();
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [rep, setRep] = useState<Report | null>(null);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    sb.from("night_reports").select("report_date").order("report_date", { ascending: false }).limit(30).then(({ data }) => {
      const d = (data ?? []).map((r) => r.report_date);
      setDates(d);
      if (d.length) setDate(d[0]);
    });
  }, [sb]);
  const load = useCallback(async () => {
    if (!date) return;
    const { data } = await sb.from("night_reports").select("*").eq("report_date", date).maybeSingle();
    setRep(data as Report | null);
    const { data: s } = await sb.from("suggestions").select("*").or(data ? `night_report_id.eq.${data.id},and(kind.eq.question,status.eq.pending)` : "kind.eq.question").order("created_at");
    setSugs((s ?? []) as Sug[]);
  }, [sb, date]);
  useEffect(() => { load(); }, [load]);

  async function decide(s: Sug, decision: "approve" | "reject" | "rollback", payload?: any) {
    const { error } = await sb.rpc("rpc_decide_suggestion", { p_id: s.id, p_decision: decision, p_payload: payload ?? null });
    setMsg(error ? (error.message === "answer_required" ? "Type the official answer first." : error.message) : decision === "approve" ? "Approved and applied." : decision === "rollback" ? "Rolled back." : "Rejected.");
    setEdit((e) => ({ ...e, [s.id]: undefined }));
    load();
  }

  const sm = rep?.summary ?? {};
  const questions = sugs.filter((s) => s.kind === "question" && s.status === "pending");
  const others = sugs.filter((s) => s.kind !== "question");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">From the night job (midnight – 6 am): all bot and staff chats · <Link href="/morning-report/night-job">see schedule</Link></p>
        <label className="flex items-center gap-2 text-sm font-semibold">Report date
          <select value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-input px-2">{dates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}</select></label>
      </div>
      {msg ? <p role="status" className="text-sm text-success">{msg}</p> : null}
      {!rep ? <Card><Empty title="No morning report yet">The night job writes it at 6:00 am. Owners can run it now from the Night job tab.</Empty></Card> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Chats audited" value={sm.chats_audited ?? 0} sub="all, not a sample" />
            <Stat label="Price given, no booking ask" value={sm.price_no_booking_ask ?? 0} />
            <Stat label="Unanswered questions" value={sm.unanswered_questions ?? 0} />
            <Stat label="Needs-staff leads nobody touched" value={sm.untouched_needs_staff ?? 0} tone={sm.untouched_needs_staff ? "warn" : undefined} />
          </div>
          {sm.insights?.length ? <Card className="p-5 text-sm"><h2 className="font-semibold">What made the difference</h2><ul className="mt-2 list-disc pl-5">{sm.insights.map((i: string) => <li key={i}>{i}</li>)}</ul></Card> : null}
          <Card>
            <CardHeader title="Suggestions for you to approve" />
            <ul className="divide-y divide-line">
              {others.length === 0 ? <li className="px-5 py-6 text-center text-sm text-muted">Nothing to approve.</li> : null}
              {others.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{KIND_LABEL[s.kind] ?? s.kind}</Badge><strong>{s.title}</strong>
                    {s.auto_applied ? <Badge tone="success">applied directly</Badge> : null}{s.status !== "pending" ? <Badge>{s.status.replace("_", " ")}</Badge> : null}</div>
                  {s.kind === "official_answer" ? (edit[s.id] ? <Textarea aria-label="Edit answer" value={edit[s.id].answer} onChange={(e) => setEdit({ ...edit, [s.id]: { ...edit[s.id], answer: e.target.value } })} /> : <p className="text-body">{s.payload.answer}</p>) : null}
                  {s.kind === "style" ? <ul className="list-disc pl-5">{(s.payload.additions ?? []).map((a: any) => <li key={a.rule}>{a.rule}</li>)}</ul> : null}
                  {s.payload.dropped_reason ? <p className="text-danger">Dropped: {s.payload.dropped_reason}</p> : null}
                  {s.evidence?.length ? <p className="text-xs text-muted">Evidence: {s.evidence.map((e: any) => typeof e === "string" ? `"${e}"` : e.conversation_id ? <Link key={e.conversation_id} href={`/inbox?c=${e.conversation_id}`} className="mr-2">chat</Link> : JSON.stringify(e)).map((x, i) => <span key={i}>{x} </span>)}</p> : null}
                  {admin || (me.role === "team_lead" && s.kind === "staff") ? (
                    <div className="flex flex-wrap gap-2">
                      {s.status === "pending" ? <>
                        <Button size="sm" variant="ghost" onClick={() => decide(s, "reject")}>Reject</Button>
                        {s.kind === "official_answer" ? <Button size="sm" variant="secondary" onClick={() => setEdit({ ...edit, [s.id]: edit[s.id] ? undefined : { ...s.payload } })}>Edit</Button> : null}
                        <Button size="sm" onClick={() => decide(s, "approve", edit[s.id])}>Approve</Button>
                      </> : null}
                      {s.auto_applied && s.status === "approved" ? <Button size="sm" variant="secondary" onClick={() => decide(s, "rollback")}>Roll back</Button> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <Card>
        <CardHeader title="Questions that need your answer" description="Customers asked these and the bot had no answer. What you type becomes an official answer." />
        <ul className="divide-y divide-line">
          {questions.length === 0 ? <li className="px-5 py-6 text-center text-sm text-muted">No open questions.</li> : null}
          {questions.map((q) => (
            <li key={q.id} className="flex flex-col gap-2 px-5 py-4 text-sm">
              <label htmlFor={`aq-${q.id}`} className="font-semibold">{q.payload.question}{q.payload.times > 1 ? ` · asked ${q.payload.times} times` : ""}</label>
              <div className="flex flex-wrap gap-2">
                <Input id={`aq-${q.id}`} className="min-w-0 flex-1" placeholder="Type the official answer…" value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} disabled={!admin} />
                {admin ? <Button onClick={() => decide(q, "approve", { ...q.payload, answer: answers[q.id] })} disabled={!answers[q.id]?.trim()}>Make it an official answer</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
