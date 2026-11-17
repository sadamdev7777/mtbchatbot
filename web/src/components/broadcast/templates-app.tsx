"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { callFunction } from "@/lib/functions";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildTemplateComponents, validTemplateName } from "@/lib/template-builder";
import { templateBody, type Template } from "@/lib/types";
import { fmtDate, fmtTime } from "@/lib/utils";

const STATUS_TONE: Record<string, "success" | "warn" | "danger" | "neutral" | "info"> = {
  APPROVED: "success", PENDING: "warn", REJECTED: "danger", DRAFT: "neutral", SUGGESTED: "info", PAUSED: "warn", DISABLED: "danger",
};

export function TemplatesApp() {
  const me = useMe();
  const admin = isAdmin(me.role);
  const sb = supabaseBrowser();
  const [list, setList] = useState<Template[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: "", category: "MARKETING", language: "ms", body: "", buttons: [""], examples: {} as Record<string, string> });

  const load = useCallback(async () => {
    const { data } = await sb.from("templates").select("*").order("name");
    setList((data ?? []) as Template[]);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  async function sync() {
    setMsg("Syncing with Meta…");
    try { await callFunction("templates-sync", {}); setMsg("Synced."); } catch (e) { setMsg((e as Error).message); }
    load();
  }
  async function submit(t: Template) {
    setMsg("");
    try { await callFunction("templates-sync", { action: "submit", template_id: t.id }); setMsg(`${t.name} submitted to Meta for review.`); } catch (e) { setMsg((e as Error).message); }
    load();
  }
  async function remove(t: Template) {
    if (!confirm(`Delete template ${t.name}?`)) return;
    const { error } = await sb.from("templates").delete().eq("id", t.id);
    setMsg(error ? (error.message.startsWith("template_in_use") ? `Can't delete: ${t.name} is used by ${t.used_by.join(", ")}.` : error.message) : `${t.name} deleted.`);
    load();
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!validTemplateName(form.name)) return setMsg("Name must be lowercase letters, numbers and underscores.");
    if (!form.body.trim()) return setMsg("Write the message body.");
    const { components } = buildTemplateComponents(form.body, form.buttons, form.examples);
    const { error } = await sb.from("templates").insert({
      company_id: me.company_id, name: form.name, category: form.category, language: form.language, components,
      status: admin ? "DRAFT" : "SUGGESTED",
    });
    setMsg(error ? (error.code === "23505" ? "A template with this name and language exists." : error.message) : admin ? "Draft saved. Submit it to Meta when ready." : "Suggestion sent to the admins.");
    if (!error) setForm({ name: "", category: "MARKETING", language: "ms", body: "", buttons: [""], examples: {} });
    load();
  }

  const vars = buildTemplateComponents(form.body, [], {}).variables;
  const lastSync = list.map((t) => t.last_synced_at).filter(Boolean).sort().pop();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">The only way to message after the 24-hour window. Status synced from Meta every 15 minutes{lastSync ? ` · last sync ${fmtDate(lastSync)} ${fmtTime(lastSync)}` : ""}.</p>
        {admin ? <Button variant="secondary" onClick={sync}>Sync with Meta</Button> : null}
      </div>
      {msg ? <p role="status" className="rounded-lg bg-panel px-3 py-2 text-sm">{msg}</p> : null}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="border-b border-line bg-panel text-xs font-semibold text-muted">
            <tr><th className="px-4 py-3">Name</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Used by</th><th className="px-3 py-3">Text</th><th className="px-3 py-3"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="border-b border-line align-top last:border-0">
                <td className="px-4 py-3 font-semibold">{t.name}<span className="ml-1 text-xs font-normal text-muted">{t.language}</span></td>
                <td className="px-3 py-3">{t.category}</td>
                <td className="px-3 py-3"><Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                  {t.rejection_reason ? <p className="mt-1 text-xs text-danger">{t.rejection_reason}</p> : null}</td>
                <td className="px-3 py-3 text-xs text-muted">{t.used_by.length ? t.used_by.join(", ") : "–"}</td>
                <td className="max-w-md px-3 py-3 text-xs text-body">{templateBody(t)}</td>
                <td className="px-3 py-3">
                  {admin ? (
                    <div className="flex gap-1">
                      {["DRAFT", "REJECTED", "SUGGESTED"].includes(t.status) ? <Button size="sm" onClick={() => submit(t)}>Submit</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => remove(t)} disabled={t.used_by.length > 0} title={t.used_by.length ? "In use" : undefined}>Delete</Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title={admin ? "New template" : "Suggest a template"} description="Write [nama], [destinasi] etc. They become variables 1, 2… when sent to Meta." />
        <form onSubmit={create} className="grid gap-4 p-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Name (lowercase, underscores)" htmlFor="t1"><Input id="t1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="susulan_selepas_harga_v1" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" htmlFor="t2"><Select id="t2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>MARKETING</option><option>UTILITY</option></Select></Field>
              <Field label="Language" htmlFor="t3"><Select id="t3" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="ms">Malay (ms)</option><option value="en">English (en)</option></Select></Field>
            </div>
            <Field label="Message" htmlFor="t4"><Textarea id="t4" rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Salam [nama], tarikh pakej [destinasi] yang cik tanya hampir penuh. Nak kami hold seat?" /></Field>
            {vars.map((v) => (
              <Field key={v} label={`Example for [${v}] (Meta needs one)`} htmlFor={`ex-${v}`}>
                <Input id={`ex-${v}`} value={form.examples[v] ?? ""} onChange={(e) => setForm({ ...form, examples: { ...form.examples, [v]: e.target.value } })} />
              </Field>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-semibold text-body">Buttons (quick replies)</p>
            {form.buttons.map((b, i) => (
              <Input key={i} aria-label={`Button ${i + 1}`} value={b} maxLength={25} onChange={(e) => setForm({ ...form, buttons: form.buttons.map((x, j) => (j === i ? e.target.value : x)) })} placeholder="Ya, hantar link" />
            ))}
            <div><Button size="sm" variant="secondary" onClick={() => setForm({ ...form, buttons: [...form.buttons, ""] })} disabled={form.buttons.length >= 10}>+ Button</Button></div>
            <p className="text-xs text-muted">Marketing templates should include a &ldquo;Jangan hantar lagi&rdquo; button so customers can opt out.</p>
            <div className="rounded-lg bg-chat-bg p-3"><p className="whitespace-pre-wrap rounded-lg bg-bubble-out p-3 text-sm">{form.body || "Preview"}</p></div>
            <div><Button type="submit">{admin ? "Save draft" : "Send suggestion"}</Button></div>
          </div>
        </form>
      </Card>
    </div>
  );
}
