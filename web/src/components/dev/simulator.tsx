"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { stripPrefix, type Message } from "@/lib/types";
import { cn, fmtTime } from "@/lib/utils";

async function post(body: unknown) {
  const r = await fetch("/api/dev/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? j.message ?? "Failed");
  return j;
}

/** Customer-side phone emulator for manual mode (Meta not connected). */
export function SimulatorApp() {
  const [waId, setWaId] = useState("60123450099");
  const [name, setName] = useState("Simulated customer");
  const [text, setText] = useState("Assalamualaikum, nak tanya pakej Kundasang bulan Mac 2027 untuk 2 orang");
  const [refId, setRefId] = useState("");
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const sb = supabaseBrowser();

  const load = useCallback(async () => {
    const { data: c } = await sb.from("contacts").select("id").eq("wa_id", waId.replace(/\D/g, "")).maybeSingle();
    if (!c) return setMsgs([]);
    const { data: conv } = await sb.from("conversations").select("id").eq("contact_id", c.id).maybeSingle();
    if (!conv) return setMsgs([]);
    const { data } = await sb.from("messages").select("*").eq("conversation_id", conv.id).eq("is_internal_note", false).not("type", "in", "(event,tool)").order("created_at");
    setMsgs((data ?? []) as Message[]);
  }, [sb, waId]);

  useEffect(() => {
    load();
    const ch = sb.channel("sim").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => load()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load, sb]);

  async function run(body: Record<string, unknown>) {
    setError("");
    try {
      await post({ wa_id: waId, name, ...body });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => run({ image: reader.result as string, text });
    reader.readAsDataURL(file);
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-4 md:grid-cols-[360px_1fr] md:p-8">
      <Card>
        <CardHeader title="WhatsApp simulator" description="Pretend to be a customer. Messages go through the real webhook, signed with the simulator secret." />
        <div className="flex flex-col gap-3 p-5">
          <Field label="Customer number (with country code)" htmlFor="sim-wa"><Input id="sim-wa" value={waId} onChange={(e) => setWaId(e.target.value)} /></Field>
          <Field label="Profile name" htmlFor="sim-name"><Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Message" htmlFor="sim-text"><Textarea id="sim-text" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Click-to-WhatsApp ad source id (first message only)" htmlFor="sim-ref" hint="Seeded ad 120210000000001 routes to Nura.">
            <Input id="sim-ref" value={refId} onChange={(e) => setRefId(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run({ text, referral_source_id: refId || undefined, referral_headline: refId ? "Sabah Welcomes You" : undefined })}>Send as customer</Button>
            <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-input px-4 text-sm font-semibold text-body">
              Send image<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} />
            </label>
            <Button variant="secondary" onClick={() => run({ text: "STOP" })}>Send STOP</Button>
          </div>
          <details className="rounded-lg border border-line p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Mock bank email (payment verification)</summary>
            <BankEmailForm onSend={async (v) => { setError(""); try { await post({ kind: "bank_email", ...v }); } catch (e) { setError((e as Error).message); } }} />
          </details>
          <p className="text-xs text-muted">Seat-lock links in bot replies open the mock TravelBoost form: submit it to lock the seat (fires seat.locked). Send a receipt as an image with a caption like &ldquo;Resit RM600 MTB-10234&rdquo;.</p>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </Card>
      <Card className="flex min-h-[600px] flex-col">
        <CardHeader title={`Phone of +${waId}`} description="Outbound messages appear here. Mark them delivered, read or failed to test statuses." />
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-chat-bg p-4">
          {msgs.map((m) => (
            <div key={m.id} className={cn("max-w-[80%] rounded-[10px] px-3 py-2 text-sm", m.direction === "in" ? "self-end bg-bubble-out" : "self-start bg-white")}>
              {m.type === "template" ? <p className="text-[11px] font-semibold uppercase text-muted">Template · {m.template_name}</p> : null}
              <p className="whitespace-pre-wrap">{m.direction === "out" ? (m.body ?? `[${m.type}]`) : (m.body ?? `[${m.type}]`)}</p>
              {m.direction === "out" && m.interactive?.buttons ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.interactive.buttons.map((b: { id: string; title: string }) => (
                    <button key={b.id} type="button" className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-info" onClick={() => run({ button: b })}>{b.title}</button>
                  ))}
                </div>
              ) : null}
              {m.direction === "out" && m.type === "template" ? (
                <TemplateButtons body={stripPrefix(m.body)} name={m.template_name ?? ""} onPick={(t) => run({ quick_reply: t })} />
              ) : null}
              <p className="mt-1 text-right text-[11px] text-muted">{fmtTime(m.created_at)} · {m.status}{m.error_code ? ` (${m.error_code})` : ""}</p>
              {m.direction === "out" && m.wa_message_id ? (
                <div className="mt-1 flex gap-1">
                  {["delivered", "read"].map((s) => <button key={s} type="button" className="text-[11px] font-semibold text-brand" onClick={() => run({ kind: "status", wa_message_id: m.wa_message_id, status: s })}>{s}</button>)}
                  <button type="button" className="text-[11px] font-semibold text-danger" onClick={() => run({ kind: "status", wa_message_id: m.wa_message_id, status: "failed", error_code: 131047 })}>fail 131047</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TemplateButtons({ name, onPick }: { body: string; name: string; onPick: (t: string) => void }) {
  const [buttons, setButtons] = useState<string[]>([]);
  useEffect(() => {
    supabaseBrowser().from("templates").select("components").eq("name", name).maybeSingle().then(({ data }) => {
      const b = (data?.components ?? []).find((c: any) => c.type === "BUTTONS");
      setButtons((b?.buttons ?? []).map((x: any) => x.text));
    });
  }, [name]);
  if (!buttons.length) return null;
  return <div className="mt-2 flex flex-wrap gap-1">{buttons.map((t) => <button key={t} type="button" className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-info" onClick={() => onPick(t)}>{t}</button>)}</div>;
}

function BankEmailForm({ onSend }: { onSend: (v: { amount: number; reference: string; sender_name: string; from: string }) => void }) {
  const [v, setV] = useState({ amount: "600", reference: "MTB-10234", sender_name: "", from: "alerts@maybank.com.my" });
  return (
    <div className="mt-2 grid gap-2">
      <Input aria-label="Amount (RM)" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="Amount" />
      <Input aria-label="Reference" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder="Reference" />
      <Input aria-label="Sender name" value={v.sender_name} onChange={(e) => setV({ ...v, sender_name: e.target.value })} placeholder="Sender name" />
      <Input aria-label="From address" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
      <Button variant="secondary" onClick={() => onSend({ ...v, amount: Number(v.amount) })}>Deliver bank email and poll</Button>
    </div>
  );
}
