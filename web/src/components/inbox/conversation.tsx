"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration, isWindowOpen, windowRemainingMs } from "@core/time.ts";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import type { Directory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatPhone, type Conversation as Conv, type ConversationLabel, type Draft, type Message } from "@/lib/types";
import { cn, fmtDate } from "@/lib/utils";
import { AssignDialog } from "./assign-dialog";
import { Composer } from "./composer";
import { CustomerPanel } from "./customer-panel";
import { MessageBubble } from "./message-bubble";
import { TemplatePicker } from "./template-picker";

export function ConversationView({ id, dir, onBack, flags }: { id: string; dir: Directory; onBack?: () => void; flags: Record<string, string> }) {
  const me = useMe();
  const sb = supabaseBrowser();
  const [conv, setConv] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [labels, setLabels] = useState<ConversationLabel[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewers, setViewers] = useState<{ member_id: string; name: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [tplOpen, setTplOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const loadConv = useCallback(async () => {
    const { data } = await sb.from("conversations").select("*, contact:contacts(*)").eq("id", id).maybeSingle();
    setConv(data as Conv | null);
  }, [id, sb]);
  const loadMessages = useCallback(async () => {
    const { data } = await sb.from("messages").select("*").eq("conversation_id", id).order("created_at").limit(500);
    setMessages((data ?? []) as Message[]);
  }, [id, sb]);
  const loadLabels = useCallback(async () => {
    const { data } = await sb.from("conversation_labels").select("*").eq("conversation_id", id);
    setLabels((data ?? []) as ConversationLabel[]);
  }, [id, sb]);
  const loadDraft = useCallback(async () => {
    const { data } = await sb.from("ai_drafts").select("*").eq("conversation_id", id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    setDraft((data as Draft | null) ?? null);
  }, [id, sb]);

  useEffect(() => {
    loadConv(); loadMessages(); loadLabels(); loadDraft();
    const ch = sb.channel(`conv-${id}`, { config: { presence: { key: me.member_id } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, (p) => {
        const row = p.new as Message;
        setMessages((list) => {
          const i = list.findIndex((m) => m.id === row.id);
          if (i >= 0) { const copy = list.slice(); copy[i] = row; return copy; }
          return [...list, row];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${id}` }, () => loadConv())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_labels", filter: `conversation_id=eq.${id}` }, () => loadLabels())
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_drafts", filter: `conversation_id=eq.${id}` }, () => loadDraft())
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<{ member_id: string; name: string }>();
        setViewers(Object.values(state).flat().filter((v) => v.member_id !== me.member_id));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ member_id: me.member_id, name: me.display_name });
      });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { sb.removeChannel(ch); clearInterval(t); };
  }, [id, sb, me.member_id, me.display_name, loadConv, loadMessages, loadLabels, loadDraft]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  if (!conv) return <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading chat…</div>;

  const contact = conv.contact!;
  const windowOpen = isWindowOpen(conv.last_inbound_at, new Date(now));
  const remaining = windowRemainingMs(conv.last_inbound_at, new Date(now));
  const holderName = conv.holder_type === "staff" ? dir.member(conv.holder_member_id)?.display_name : conv.holder_type === "ai" ? `${dir.agent(conv.agent_id)?.name ?? "AI"} (AI)` : "Nobody";
  const heldByOther = conv.holder_type === "staff" && conv.holder_member_id !== me.member_id;
  const iHold = conv.holder_type === "staff" && conv.holder_member_id === me.member_id;
  const agent = dir.agent(conv.agent_id);
  const channel = dir.channels.find((c) => c.id === conv.channel_id);

  async function act(fn: string, args: Record<string, unknown>) {
    setError("");
    const { error: e } = await sb.rpc(fn, args);
    if (e) setError(e.message);
    else loadConv();
  }

  const withDays = messages.map((m, i) => ({ m, day: fmtDate(m.created_at), sep: i === 0 || fmtDate(messages[i - 1].created_at) !== fmtDate(m.created_at) }));
  return (
    <div className="flex h-full min-h-0 flex-1">
      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col bg-chat-bg">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {onBack ? <button type="button" onClick={onBack} aria-label="Back to chats" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-chip md:hidden">←</button> : null}
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{contact.name ?? `+${contact.wa_id}`}</p>
              <p className="text-[13px] text-muted">
                {formatPhone(contact.wa_id)} · {channel?.display_name ?? "WhatsApp"} ·{" "}
                <span className={cn(!windowOpen && "font-semibold text-danger")}>{windowOpen ? `24-hour window: ${formatDuration(remaining)} left` : "24-hour window closed"}</span>
              </p>
              <p className="text-[13px] text-muted">Owner: <strong className="text-ink">{holderName}</strong>
                {viewers.length ? <span className="ml-2">· {viewers.map((v) => v.name).join(", ")} viewing</span> : null}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {conv.holder_type !== "staff" || heldByOther ? (
              <Button variant="warn" className="h-11 md:h-10" onClick={() => act("rpc_take_over", { p_conv: conv.id })}>Take over</Button>
            ) : null}
            {iHold && conv.agent_id ? <Button variant="secondary" onClick={() => act("rpc_return_to_bot", { p_conv: conv.id })}>Return to bot</Button> : null}
            <Button variant="secondary" onClick={() => setAssignOpen(true)}>Assign</Button>
            {conv.status === "closed"
              ? <Button variant="secondary" onClick={() => act("rpc_reopen", { p_conv: conv.id })}>Reopen</Button>
              : <Button variant="secondary" onClick={() => act("rpc_close", { p_conv: conv.id })}>Close chat</Button>}
            <Button variant="ghost" className="xl:hidden" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>Info</Button>
          </div>
        </header>

        {conv.holder_type === "ai" && conv.needs_staff ? (
          <div role="status" className="border-b border-warn-line bg-warn-soft px-5 py-2.5 text-sm text-warn-ink">
            The bot handed this chat to {dir.team(conv.team_id)?.name ?? "staff"}. Click <strong>Take over</strong> to reply yourself; the bot stops for this chat.
          </div>
        ) : iHold && agent ? (
          <div role="status" className="flex flex-wrap justify-between gap-3 border-b border-[#A6D8CB] bg-brand-soft px-5 py-2.5 text-sm text-brand-darker">
            <span>You own this chat. {agent.name} is in <strong>Assist mode</strong> here: drafts only, nothing is sent.</span>
            {viewers.length ? <span className="text-body">{viewers.map((v) => v.name).join(", ")} viewing · notes only</span> : null}
          </div>
        ) : heldByOther ? (
          <div role="status" className="border-b border-line bg-panel px-5 py-2.5 text-sm text-body">
            <strong>{holderName} owns this chat.</strong> You can add internal notes; take over to reply.
          </div>
        ) : null}
        {error ? <p role="alert" className="bg-danger-soft px-5 py-2 text-sm text-danger">{error}</p> : null}

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4 md:p-5" aria-live="polite">
          {withDays.map(({ m, day, sep }) => (
            <div key={m.id} className="contents">
              {sep ? <div className="self-center rounded-md bg-white px-2.5 py-1 text-xs text-muted">{day}</div> : null}
              <MessageBubble m={m} dir={dir} />
            </div>
          ))}
          <div ref={bottom} />
        </div>

        <Composer conv={conv} dir={dir} locked={heldByOther} lockedBy={heldByOther ? holderName : undefined} windowOpen={windowOpen}
          draft={draft} onOpenTemplates={() => setTplOpen(true)} onSent={() => { loadConv(); loadDraft(); }} />
      </section>

      <div className={cn("w-80 shrink-0", panelOpen ? "fixed inset-0 z-40 w-full bg-white xl:static xl:w-80" : "hidden xl:block")}>
        {panelOpen ? <div className="flex justify-end border-b border-line p-2 xl:hidden"><Button variant="ghost" onClick={() => setPanelOpen(false)}>Close</Button></div> : null}
        <CustomerPanel conv={conv} dir={dir} labels={labels} stageEditable={flags.travelboost !== "connected"} />
      </div>

      <TemplatePicker open={tplOpen} onClose={() => setTplOpen(false)} conversationId={conv.id} customerName={contact.name ?? "Cik"}
        destination={conv.key_details?.destination} staffName={me.display_name} onSent={loadConv} />
      {assignOpen ? <AssignDialog open onClose={() => { setAssignOpen(false); loadConv(); }} conv={conv} dir={dir} /> : null}
    </div>
  );
}
