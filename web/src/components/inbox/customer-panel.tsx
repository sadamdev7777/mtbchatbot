"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/misc";
import type { Directory } from "@/lib/directory";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STAGES, stageLabel, type Conversation, type ConversationLabel } from "@/lib/types";
import { labelStyle, cn } from "@/lib/utils";

const GROUPS = [{ key: "temperature", label: "Temperature" }, { key: "source", label: "Source" }, { key: "attention", label: "Attention" }, { key: "custom", label: "Custom" }] as const;

export function CustomerPanel({ conv, dir, labels, stageEditable }: { conv: Conversation; dir: Directory; labels: ConversationLabel[]; stageEditable: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const sb = supabaseBrowser();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const contact = conv.contact!;
  const agent = dir.agent(conv.agent_id);
  const waited = conv.needs_staff_since ? Math.floor((now - Date.parse(conv.needs_staff_since)) / 60000) : 0;
  const kd = conv.key_details ?? {};
  const pax = kd.adults !== undefined ? `${kd.adults} adults${kd.children ? `, ${kd.children} children` : ""}` : kd.pax ? String(kd.pax) : "–";

  async function addLabel(id: string) {
    setAdding(false);
    const { error } = await sb.rpc("rpc_set_label", { p_conv: conv.id, p_label: id, p_reason: null });
    setErr(error?.message ?? "");
  }
  async function removeLabel(id: string) {
    const { error } = await sb.rpc("rpc_remove_label", { p_conv: conv.id, p_label: id });
    setErr(error?.message ?? "");
  }
  async function setStage(stage: string) {
    const { error } = await sb.rpc("rpc_set_stage", { p_conv: conv.id, p_stage: stage });
    setErr(error?.message ?? "");
  }

  return (
    <aside aria-label="Customer profile" className="flex h-full flex-col gap-4 overflow-y-auto border-l border-line bg-white p-5">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <Avatar name={contact.name ?? contact.wa_id} size={56} light />
        <p className="text-base font-bold">{contact.name ?? `+${contact.wa_id}`}</p>
        <Link href={`/contacts/${contact.id}`} className="text-[13px] font-semibold">Open full profile</Link>
      </div>
      <div className="flex flex-col gap-2 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="text-muted">Stage</span>
          {stageEditable ? (
            <select aria-label="Stage" value={conv.stage} onChange={(e) => setStage(e.target.value)} className="rounded-full border border-line bg-chip px-2 py-0.5 font-bold">
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          ) : <span className="rounded-full bg-chip px-2.5 py-0.5 font-bold text-body">{stageLabel(conv.stage)}</span>}
        </div>
        <p className="text-xs text-muted">{stageEditable ? "TravelBoost is not connected: change the stage by hand." : "Automatic from TravelBoost. Deposit received = Deposit."}</p>
        <Row k="Chat status" v={conv.status === "waiting_customer" ? "Waiting for customer" : conv.status === "closed" ? "Closed" : "Open"} />
        <Row k="Team" v={dir.team(conv.team_id)?.name ?? "Unassigned"} />
        <Row k="Agent" v={agent ? `${agent.name}${agent.description ? ` · ${agent.description}` : ""}` : "–"} />
      </div>

      {conv.needs_staff ? (
        <div role="note" className="flex flex-col gap-1 rounded-[10px] border border-warn-line bg-warn-soft p-3">
          <p className="text-[13px] font-bold text-warn-ink">Needs staff · {waited} min</p>
          <p className="text-[13px] leading-normal text-body">Reason: {conv.needs_staff_reason}</p>
          <p className="text-xs text-muted">Clears itself when staff replies or takes over</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted">Labels</span>
          <div className="relative">
            <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding}
              className="h-7 rounded border border-dashed border-faint bg-white px-2 text-xs font-semibold text-body">+ Label</button>
            {adding ? (
              <ul className="absolute right-0 z-10 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-line bg-white shadow-lg">
                {dir.labels.filter((l) => l.group !== "source" && !labels.some((x) => x.label_id === l.id)).map((l) => (
                  <li key={l.id}><button type="button" onClick={() => addLabel(l.id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-panel">
                    <span className="text-xs text-muted">{GROUPS.find((g) => g.key === l.group)?.label} · </span>{l.name}</button></li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-[80px_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-xs">
          {GROUPS.map((g) => {
            const items = labels.map((cl) => ({ cl, l: dir.label(cl.label_id)! })).filter((x) => x.l?.group === g.key);
            if (g.key === "custom" && !items.length) return null;
            return (
              <div key={g.key} className="contents">
                <span className="pt-0.5 text-muted">{g.label}</span>
                <span className="flex flex-col gap-1">
                  {items.length === 0 ? <span className="text-muted">none</span> : items.map(({ cl, l }) => (
                    <span key={cl.id} className="flex flex-wrap items-center gap-1">
                      <span className={cn("rounded px-2 py-0.5 font-bold", !cl.confirmed && "outline outline-1 outline-dashed")} style={labelStyle(l.colour)}>{l.name}</span>
                      <span className="text-muted">
                        {cl.set_by_type === "ai" ? `by ${dir.agent(cl.set_by_agent_id)?.name ?? "AI"}` : cl.set_by_type === "staff" ? `by ${dir.member(cl.set_by_member_id)?.display_name ?? "staff"}` : ""}
                        {cl.reason ? ` · ${cl.reason}` : ""}{!cl.confirmed ? " · suggested" : ""}
                      </span>
                      {!cl.confirmed ? <button type="button" className="font-semibold text-brand" onClick={() => addLabel(l.id)}>Confirm</button> : null}
                      {l.group !== "source" ? <button type="button" aria-label={`Remove ${l.name}`} className="text-faint hover:text-danger" onClick={() => removeLabel(l.id)}>✕</button> : null}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
        {err ? <p role="alert" className="text-xs text-danger">{err}</p> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
        <span className="text-xs font-semibold text-muted">AI summary</span>
        <p className="leading-normal text-body">{conv.ai_summary ?? "No summary yet."}</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
        <Row k="Destination" v={kd.destination ?? "–"} />
        <Row k="Pax" v={pax} />
        {conv.booking_ref ? <Row k="Booking" v={conv.booking_ref} /> : null}
        {conv.referral?.headline ? <Row k="Ad" v={conv.referral.headline} /> : null}
      </div>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="text-right font-semibold">{v}</span></div>;
}
