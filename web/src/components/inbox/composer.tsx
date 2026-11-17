"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import type { Directory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Conversation, Draft } from "@/lib/types";
import { cn, fmtTime } from "@/lib/utils";

export function Composer({ conv, dir, locked, lockedBy, windowOpen, draft, onOpenTemplates, onSent }: {
  conv: Conversation; dir: Directory; locked: boolean; lockedBy?: string; windowOpen: boolean; draft: Draft | null;
  onOpenTemplates: () => void; onSent: () => void;
}) {
  const me = useMe();
  const [mode, setMode] = useState<"reply" | "note">(locked ? "note" : "reply");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usedDraft, setUsedDraft] = useState<Draft | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const sb = supabaseBrowser();

  useEffect(() => { setMode(locked ? "note" : "reply"); }, [locked]);
  useEffect(() => { setText(""); setError(""); setUsedDraft(null); }, [conv.id]);

  const replyDisabled = mode === "reply" && (locked || !windowOpen);

  const quick = useMemo(() => {
    if (mode !== "reply" || !text.startsWith("/")) return [];
    const k = text.slice(1).toLowerCase();
    return dir.quickReplies.filter((q) => q.shortcut.toLowerCase().startsWith(k)).slice(0, 6);
  }, [text, mode, dir.quickReplies]);

  const mentionQuery = mode === "note" ? text.match(/@(\w*)$/)?.[1] : undefined;
  const mentionList = mentionQuery !== undefined
    ? dir.members.filter((m) => m.status === "active" && m.display_name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6) : [];

  function onType(v: string) {
    setText(v);
    // Rule 3: typing blocks the AI for 2 minutes (refreshed at most every 30s).
    if (mode === "reply" && v.trim() && Date.now() - lastTyping.current > 30_000) {
      lastTyping.current = Date.now();
      sb.rpc("rpc_set_typing", { p_conv: conv.id });
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "note") {
        const mentions = dir.members.filter((m) => body.includes("@" + m.display_name)).map((m) => m.id);
        const { error: e } = await sb.rpc("rpc_add_note", { p_conv: conv.id, p_body: body, p_mentions: mentions });
        if (e) throw new Error(e.message);
      } else {
        await callFunction("wa-send", { conversation_id: conv.id, kind: "text", body, sender_type: "staff" });
        if (usedDraft) {
          await sb.rpc("rpc_draft_decision", { p_draft: usedDraft.id, p_decision: body === usedDraft.body.trim() ? "used" : "edited", p_final: body });
        }
      }
      setText("");
      setUsedDraft(null);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File) {
    setBusy(true);
    setError("");
    try {
      const path = `${me.company_id}/outbound/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error: up } = await sb.storage.from("media").upload(path, file, { contentType: file.type });
      if (up) throw new Error(up.message);
      await callFunction("wa-send", {
        conversation_id: conv.id, kind: "media", sender_type: "staff",
        media: { path, mime: file.type || "application/octet-stream", filename: file.name, caption: text.trim() || undefined },
      });
      setText("");
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function discardDraft() {
    if (!draft) return;
    await sb.rpc("rpc_draft_decision", { p_draft: draft.id, p_decision: "discarded", p_final: null });
    onSent();
  }

  async function rewrite() {
    if (!draft) return;
    setRewriting(true);
    setError("");
    try {
      await callFunction("ai-orchestrator", { action: "rewrite_draft", draft_id: draft.id, instruction: "shorter" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRewriting(false);
    }
  }

  const agentName = dir.agent(draft?.agent_id ?? conv.agent_id)?.name ?? "AI";

  return (
    <div className="flex flex-col gap-2.5 border-t border-line bg-white px-4 py-3">
      <div role="tablist" aria-label="Message type" className="flex gap-1">
        {(["reply", "note"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} disabled={k === "reply" && locked}
            className={cn("h-8 px-2.5 text-[13px] disabled:opacity-40", mode === k ? "border-b-2 border-brand font-semibold text-brand-darker" : "font-medium text-muted")}>
            {k === "reply" ? "Reply" : "Internal note"}
          </button>
        ))}
      </div>

      {locked && lockedBy ? (
        <p className="rounded-lg bg-panel px-3 py-2 text-[13px] text-muted"><strong className="text-ink">{lockedBy} owns this chat.</strong> You can write internal notes, or take over to reply.</p>
      ) : mode === "reply" && conv.holder_type === "ai" && windowOpen ? (
        <p className="rounded-lg bg-panel px-3 py-2 text-[13px] text-muted">Start typing to take over automatically. The bot stops when you type, and its unsent reply is cancelled.</p>
      ) : null}

      {mode === "reply" && !windowOpen && !locked ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">
          <span>The 24-hour window has closed. Only Meta-approved templates can be sent.</span>
          <Button size="sm" onClick={onOpenTemplates}>Choose template</Button>
        </div>
      ) : null}

      {draft && mode === "reply" && !locked ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[#C4B5FD] bg-[#F5F3FF] px-3.5 py-3" aria-label="AI draft">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <span className="font-bold text-ai-dark">Draft by {agentName}</span>
            <span className="text-muted">{draft.seat_data?.summary ? `Seats checked in TravelBoost ${fmtTime(draft.seat_data.checked_at ?? draft.created_at)} · ${draft.seat_data.summary}` : `Written ${fmtTime(draft.created_at)}`}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft.body}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ai" onClick={() => { setText(draft.body); setUsedDraft(draft); }} disabled={!windowOpen}>Use draft</Button>
            <Button size="sm" variant="secondary" onClick={rewrite} disabled={rewriting}>{rewriting ? "Rewriting…" : "Rewrite shorter"}</Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>Discard</Button>
          </div>
        </div>
      ) : null}

      <div className="relative">
        <label htmlFor="reply" className="sr-only">{mode === "note" ? "Internal note" : "Message"}</label>
        <textarea id="reply" rows={2} value={text} disabled={replyDisabled}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !quick.length && !mentionList.length) { e.preventDefault(); send(); } }}
          placeholder={mode === "note" ? "Internal note… use @ to mention" : replyDisabled ? "Free text is disabled" : "Type a reply… use / for quick replies"}
          className={cn("w-full resize-none rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 disabled:bg-chip",
            mode === "note" ? "border-warn-line bg-[#FFFDF2] focus:ring-warn-line/50" : "border-input focus:ring-brand/20")} />
        {quick.length ? (
          <ul className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-lg border border-line bg-white shadow-lg" aria-label="Quick replies">
            {quick.map((q) => (
              <li key={q.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-panel" onClick={() => setText(q.body)}>
                <strong>/{q.shortcut}</strong> <span className="text-muted">{q.body.slice(0, 80)}</span></button></li>
            ))}
          </ul>
        ) : null}
        {mentionList.length ? (
          <ul className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-line bg-white shadow-lg" aria-label="Mention">
            {mentionList.map((m) => (
              <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-panel"
                onClick={() => setText(text.replace(/@(\w*)$/, `@${m.display_name} `))}>@{m.display_name}</button></li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
          <button type="button" aria-label="Attach file" disabled={replyDisabled || mode === "note" || busy} onClick={() => fileRef.current?.click()}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-input bg-white disabled:opacity-40">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          <Button variant="secondary" onClick={onOpenTemplates} disabled={locked}>Template</Button>
          <Button variant="secondary" onClick={() => setText("/")} disabled={replyDisabled || mode === "note"}>Quick reply</Button>
        </div>
        <Button onClick={send} disabled={busy || !text.trim() || replyDisabled} className="min-w-20">{mode === "note" ? "Add note" : "Send"}</Button>
      </div>
    </div>
  );
}
