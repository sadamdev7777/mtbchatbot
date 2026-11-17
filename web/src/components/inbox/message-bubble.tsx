"use client";
import { useEffect, useState } from "react";
import type { Directory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { stripPrefix, type Message } from "@/lib/types";
import { cn, fmtTime } from "@/lib/utils";

function Ticks({ status }: { status: string }) {
  if (status === "failed") return null;
  const label = { queued: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", received: "" }[status] ?? status;
  const marks = status === "sent" ? "✓" : status === "delivered" || status === "read" ? "✓✓" : status === "queued" ? "🕓" : "";
  return label ? <span title={label} className={cn(status === "read" && "text-info")}>{marks} {label}</span> : null;
}

function Media({ m }: { m: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!m.media_path) return;
    supabaseBrowser().storage.from("media").createSignedUrl(m.media_path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [m.media_path]);
  if (!m.media_path) return <p className="text-xs italic text-muted">[{m.type}] media not available</p>;
  if (!url) return <p className="text-xs text-muted">Loading {m.type}…</p>;
  if (m.type === "image" || m.type === "sticker") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.media_filename ?? "Image from chat"} className="max-h-64 rounded-md" /></a>;
  if (m.type === "audio") return <audio controls src={url} className="max-w-full" />;
  if (m.type === "video") return <video controls src={url} className="max-h-64 rounded-md" />;
  return <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold">📄 {m.media_filename ?? "Document"}</a>;
}

export function MessageBubble({ m, dir }: { m: Message; dir: Directory }) {
  if (m.type === "event") {
    const handover = m.meta?.kind === "needs_staff" || m.meta?.kind === "handover";
    return (
      <div className={cn("self-center max-w-[80%] rounded-lg px-3 py-2 text-center text-[13px]", handover ? "bg-note text-warn-ink" : "bg-white text-muted")}>
        {m.body} <span className="ml-1 text-[11px] opacity-70">{fmtTime(m.created_at)}</span>
      </div>
    );
  }
  if (m.type === "tool") {
    return <p className="self-end text-[11px] text-muted">{m.body}</p>;
  }
  if (m.is_internal_note) {
    const who = dir.member(m.sender_member_id)?.display_name ?? "Staff";
    const mentions: string[] = m.meta?.mentions ?? [];
    return (
      <div className="self-stretch rounded-lg border border-dashed border-[#EAAA08] bg-[#FFF8D6] px-3 py-2.5 text-[13px] text-[#713B12]">
        <strong>Internal note · {who}:</strong> <span className="whitespace-pre-wrap">{m.body}</span>
        {mentions.length ? <span className="ml-1 text-[11px]">({mentions.map((id) => "@" + (dir.member(id)?.display_name ?? "?")).join(", ")})</span> : null}
        <span className="ml-2 text-[11px] opacity-70">{fmtTime(m.created_at)}</span>
      </div>
    );
  }
  const inbound = m.direction === "in";
  const label = m.sender_type === "ai"
    ? `${dir.agent(m.sender_agent_id)?.name ?? "AI"} (AI) · sent as "${(m.body ?? "").match(/^\*([^*\n]+)\*/)?.[1] ?? "Pembantu AI"}"`
    : m.sender_type === "staff" ? dir.member(m.sender_member_id)?.display_name ?? "Staff"
    : m.sender_type === "system" && !inbound ? "System" : null;
  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(m.type);
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1 md:max-w-[70%]", inbound ? "self-start" : "self-end items-end")}>
      {label ? <span className={cn("text-[11px] font-semibold", m.sender_type === "ai" ? "text-ai" : "text-muted")}>{label}</span> : null}
      <div className={cn("rounded-[10px] px-3 py-2.5 text-sm leading-normal", inbound ? "bg-white" : "bg-bubble-out", m.status === "failed" && "border border-danger")}>
        {m.type === "template" ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Template · {m.template_name}</p> : null}
        {isMedia ? <Media m={m} /> : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{inbound ? m.body : stripPrefix(m.body)}</p> : null}
        {m.type === "interactive" && m.meta?.button_id ? <p className="mt-1 text-[11px] text-muted">Button reply</p> : null}
        {m.direction === "out" && m.type === "interactive" && m.interactive?.buttons ? (
          <div className="mt-2 flex flex-wrap gap-1">{m.interactive.buttons.map((b: any) => <span key={b.id} className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-info">{b.title}</span>)}</div>
        ) : null}
        <p className="mt-1 text-right text-[11px] text-muted">{fmtTime(m.created_at)}{!inbound ? <> · <Ticks status={m.status} /></> : null}</p>
      </div>
      {m.status === "failed" ? (
        <p role="alert" className="text-xs font-semibold text-danger">
          Failed to send{m.error_code ? ` (${m.error_code})` : ""}{m.error_text ? `: ${m.error_text}` : ""}{m.error_code === "131047" ? " · Use a template." : ""}
        </p>
      ) : null}
    </div>
  );
}
