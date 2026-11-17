"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { templateBody, templateVarCount, type Template } from "@/lib/types";

export function TemplatePicker({ open, onClose, conversationId, customerName, destination, staffName, onSent }: {
  open: boolean; onClose: () => void; conversationId: string; customerName: string; destination?: string; staffName: string; onSent: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Template | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabaseBrowser().from("templates").select("*").eq("status", "APPROVED").order("name").then(({ data }) => setTemplates((data ?? []) as Template[]));
  }, [open]);

  const list = useMemo(() => templates.filter((t) => t.name.includes(q.toLowerCase())), [templates, q]);

  function choose(t: Template) {
    setPick(t);
    const n = templateVarCount(t);
    const defaults = [customerName, staffName, destination ?? ""];
    setVars(Array.from({ length: n }, (_, i) => defaults[i] ?? ""));
  }

  const preview = pick ? templateBody(pick).replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[Number(n) - 1] || `{{${n}}}`) : "";

  async function send() {
    if (!pick) return;
    setBusy(true);
    setError("");
    try {
      await callFunction("wa-send", { conversation_id: conversationId, kind: "template", sender_type: "staff", template: { name: pick.name, language: pick.language, params: vars } });
      onSent();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Send template to ${customerName}`} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={send} disabled={!pick || busy || vars.some((v) => !v.trim())}>Send template</Button></>}>
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-2">
          <label htmlFor="tq" className="sr-only">Search templates</label>
          <Input id="tq" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {list.length === 0 ? <li className="p-3 text-sm text-muted">No approved templates. Submit templates in Broadcast › Templates.</li> : null}
            {list.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => choose(t)} aria-pressed={pick?.id === t.id}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${pick?.id === t.id ? "border-brand bg-brand-tint" : "border-line hover:bg-panel"}`}>
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="mt-0.5 flex gap-1"><Badge>{t.category}</Badge><Badge tone="success">Approved</Badge></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          {pick ? (
            <>
              <div className="rounded-lg bg-chat-bg p-3"><p className="whitespace-pre-wrap rounded-lg bg-bubble-out p-3 text-sm">{preview}</p></div>
              {vars.map((v, i) => (
                <Field key={i} label={`Variable ${i + 1}`} htmlFor={`v${i}`}>
                  <Input id={`v${i}`} value={v} onChange={(e) => setVars(vars.map((x, j) => (j === i ? e.target.value : x)))} />
                </Field>
              ))}
              <p className="text-xs text-muted">{pick.category} templates are charged by Meta per message. When the customer replies, the 24-hour window reopens and the bot or staff can reply normally.</p>
            </>
          ) : <p className="text-sm text-muted">Choose a template on the left.</p>}
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}
