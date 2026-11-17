"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";

interface OA { id: string; question: string; variants: string[]; answer: string; usage_count: number; source: string; status: string }

export function OfficialAnswers({ agentId }: { agentId?: string }) {
  const me = useMe();
  const admin = isAdmin(me.role);
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<OA[]>([]);
  const [edit, setEdit] = useState<{ id?: string; question: string; variants: string; answer: string } | null>(null);
  const load = useCallback(async () => {
    let q = sb.from("official_answers").select("*").eq("status", "active").order("usage_count", { ascending: false });
    q = agentId ? q.eq("agent_id", agentId) : q.eq("scope", "company");
    setRows(((await q).data ?? []) as OA[]);
  }, [sb, agentId]);
  useEffect(() => { load(); }, [load]);
  async function save() {
    if (!edit) return;
    const row = { company_id: me.company_id, scope: agentId ? "agent" : "company", agent_id: agentId ?? null, question: edit.question.trim(), answer: edit.answer.trim(),
      variants: edit.variants.split("\n").map((v) => v.trim()).filter(Boolean), source: me.role === "owner" ? "owner" : "staff" };
    if (edit.id) await sb.from("official_answers").update(row).eq("id", edit.id);
    else await sb.from("official_answers").insert(row);
    setEdit(null);
    load();
  }
  async function archive(id: string) {
    await sb.from("official_answers").update({ status: "archived" }).eq("id", id);
    load();
  }
  return (
    <Card>
      <CardHeader title={`${agentId ? "Official answers" : "Company official answers"} (${rows.length})`} description="These override everything else. The agent gets the closest matches for each question, not the whole list."
        action={admin ? <Button size="sm" variant="secondary" onClick={() => setEdit({ question: "", variants: "", answer: "" })}>+ Add</Button> : null} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
            <div><p className="font-semibold">{r.question}</p><p className="text-body">{r.answer}</p>
              <p className="text-xs text-muted">used {r.usage_count} times · {r.source}{r.variants.length ? ` · also: ${r.variants.join(", ")}` : ""}</p></div>
            {admin ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, question: r.question, variants: r.variants.join("\n"), answer: r.answer })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => archive(r.id)}>Remove</Button></div> : null}
          </li>
        ))}
      </ul>
      {edit ? (
        <div className="flex flex-col gap-3 border-t border-line p-5">
          <Field label="Question" htmlFor="oa-q"><Input id="oa-q" placeholder="Contoh: Boleh bawa stroller?" value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} /></Field>
          <Field label="Other ways customers ask (one per line)" htmlFor="oa-v"><Textarea id="oa-v" rows={2} value={edit.variants} onChange={(e) => setEdit({ ...edit, variants: e.target.value })} /></Field>
          <Field label="Official answer (Malay)" htmlFor="oa-a"><Textarea id="oa-a" rows={3} value={edit.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} /></Field>
          <div className="flex gap-2"><Button onClick={save} disabled={!edit.question.trim() || !edit.answer.trim()}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
        </div>
      ) : null}
    </Card>
  );
}
