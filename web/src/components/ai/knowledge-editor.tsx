"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge, Card } from "@/components/ui/misc";
import { callFunction, FunctionError } from "@/lib/functions";
import { isAdmin } from "@/lib/roles";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, fmtDate } from "@/lib/utils";

interface Doc { id: string; section: string; version: number; status: string; content: string; source: string; created_at: string; activated_at: string | null }

export const SECTION_LABEL: Record<string, string> = {
  payments: "Payments & bank account", cancellation: "General cancellation policy", booking_documents: "Booking & documents",
  language_style: "MTB language style", about: "About Muslimtravelbug", package: "Package overview", hotels: "Hotels", faq: "Package FAQ",
};

/** Versioned knowledge per section: edit → save as vN+1 (draft) → activate (runs test scenarios first) → roll back. */
export function KnowledgeEditor({ scope, agentId, defaultSections }: { scope: "company" | "agent"; agentId?: string; defaultSections: string[] }) {
  const me = useMe();
  const admin = isAdmin(me.role);
  const sb = supabaseBrowser();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [section, setSection] = useState(defaultSections[0]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSection, setNewSection] = useState("");

  const load = useCallback(async () => {
    let q = sb.from("knowledge_docs").select("id, section, version, status, content, source, created_at, activated_at").eq("scope", scope).order("version", { ascending: false });
    q = scope === "agent" ? q.eq("agent_id", agentId!) : q.is("agent_id", null);
    const { data } = await q;
    setDocs((data ?? []) as Doc[]);
  }, [sb, scope, agentId]);
  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => [...new Set([...defaultSections, ...docs.map((d) => d.section)])], [docs, defaultSections]);
  const versions = docs.filter((d) => d.section === section);
  const active = versions.find((d) => d.status === "active");
  const latestDraft = versions.find((d) => d.status === "draft" && (!active || d.version > active.version));
  useEffect(() => { setText((latestDraft ?? active)?.content ?? ""); setMsg(null); }, [section, latestDraft?.id, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setBusy(true);
    const { error } = await sb.rpc("rpc_save_knowledge", { p_scope: scope, p_agent: agentId ?? null, p_section: section, p_content: text });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Saved as a draft. Activate it to make the agents use it." });
    setBusy(false);
    load();
  }
  async function activate(doc: Doc) {
    setBusy(true);
    setMsg({ ok: true, text: "Running test scenarios before activating…" });
    try {
      const r = await callFunction<{ runs: { passed: number; total: number }[] }>("ai-orchestrator", { action: "activate_knowledge", doc_id: doc.id });
      setMsg({ ok: true, text: `Activated v${doc.version}. Scenarios: ${r.runs.map((x) => `${x.passed}/${x.total}`).join(", ") || "no live agents"}.` });
    } catch (e) {
      const fe = e as FunctionError;
      setMsg({ ok: false, text: fe.message });
    }
    setBusy(false);
    load();
  }
  async function rollback() {
    const { error } = await sb.rpc("rpc_rollback_knowledge", { p_scope: scope, p_agent: agentId ?? null, p_section: section });
    setMsg(error ? { ok: false, text: error.message === "nothing_to_roll_back" ? "There is no older version." : error.message } : { ok: true, text: "Rolled back to the previous version." });
    load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <nav aria-label="Knowledge sections" className="flex flex-col gap-1">
        {sections.map((s) => {
          const a = docs.find((d) => d.section === s && d.status === "active");
          return (
            <button key={s} type="button" onClick={() => setSection(s)} aria-current={s === section ? "page" : undefined}
              className={cn("rounded-lg px-3 py-2 text-left text-sm", s === section ? "bg-brand-tint font-semibold text-brand-darker" : "hover:bg-chip")}>
              {SECTION_LABEL[s] ?? s}
              <span className="block text-xs font-normal text-muted">{a ? `v${a.version} · active${a.source === "night_job" ? " · night job" : ""}` : "no active version"}</span>
            </button>
          );
        })}
        {admin ? (
          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newSection.trim()) { setSection(newSection.trim().toLowerCase().replace(/\W+/g, "_")); setNewSection(""); } }}>
            <input aria-label="New section" placeholder="New section" value={newSection} onChange={(e) => setNewSection(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-input px-2 text-sm" />
            <Button type="submit" size="sm" variant="secondary">Add</Button>
          </form>
        ) : null}
      </nav>
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{SECTION_LABEL[section] ?? section}</h2>
            <p className="text-xs text-muted">{active ? `v${active.version} active since ${fmtDate(active.activated_at ?? active.created_at)}` : "Not active yet"}{latestDraft ? ` · draft v${latestDraft.version} waiting` : ""}</p>
          </div>
          {admin ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={save} disabled={busy || !text.trim() || text === (latestDraft ?? active)?.content}>Save as v{(versions[0]?.version ?? 0) + 1}</Button>
              {latestDraft ? <Button size="sm" onClick={() => activate(latestDraft)} disabled={busy}>Activate v{latestDraft.version}</Button> : null}
              {versions.some((v) => v.status === "archived") ? <Button size="sm" variant="ghost" onClick={rollback}>Roll back</Button> : null}
            </div>
          ) : null}
        </div>
        <p role="note" className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">Never put seat counts or prices here: agents get dates, prices and seats live from TravelBoost every time a customer asks.</p>
        <Textarea aria-label="Knowledge text (Markdown)" rows={16} value={text} onChange={(e) => setText(e.target.value)} disabled={!admin} className="font-mono text-[13px]" />
        {msg ? <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p> : null}
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-muted">Version history ({versions.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <span>v{v.version}</span><Badge tone={v.status === "active" ? "success" : v.status === "draft" ? "warn" : "neutral"}>{v.status}</Badge>
                <span className="text-xs text-muted">{v.source} · {fmtDate(v.created_at)}</span>
                <button type="button" className="text-xs font-semibold text-brand" onClick={() => setText(v.content)}>Load</button>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}
