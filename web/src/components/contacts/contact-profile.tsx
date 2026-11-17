"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { useDirectory } from "@/lib/directory";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatPhone, stageLabel, type Contact } from "@/lib/types";
import { fmtDate, fmtTime, rm } from "@/lib/utils";

interface Booking {
  id: string; status: string; product_name: string; start_date: string; end_date: string;
  pax: { adults: number; children: number; infants: number }; deposit_paid: number; total: number; balance: number; balance_due: string | null;
  passengers: { name: string; is_lead?: boolean; passport_received: boolean }[]; url?: string;
}

export function ContactProfile({ id }: { id: string }) {
  const me = useMe();
  const dir = useDirectory();
  const sb = supabaseBrowser();
  const [c, setC] = useState<Contact | null>(null);
  const [convs, setConvs] = useState<{ id: string; stage: string; status: string; created_at: string }[]>([]);
  const [timeline, setTimeline] = useState<{ title: string; sub?: string; when: string }[]>([]);
  const [notes, setNotes] = useState<{ id: string; body: string; member_id: string; created_at: string }[]>([]);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [tbMsg, setTbMsg] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saved, setSaved] = useState("");
  const canEdit = me.role !== "staff" && me.role !== "accounts";

  const load = useCallback(async () => {
    const { data } = await sb.from("contacts").select("*").eq("id", id).maybeSingle();
    setC(data as Contact | null);
    const { data: cv } = await sb.from("conversations").select("id, stage, status, created_at").eq("contact_id", id);
    setConvs(cv ?? []);
    const ids = (cv ?? []).map((x) => x.id);
    if (ids.length) {
      const { data: ev } = await sb.from("messages").select("body, created_at, type, direction, sender_type")
        .in("conversation_id", ids).or("type.eq.event,and(direction.eq.in,type.eq.text)").order("created_at", { ascending: false }).limit(40);
      setTimeline((ev ?? []).map((e) => ({
        title: e.type === "event" ? e.body ?? "" : `Customer: ${(e.body ?? "").slice(0, 90)}`,
        when: `${fmtDate(e.created_at)} ${fmtTime(e.created_at)}`,
      })));
    }
    const { data: n } = await sb.from("notes").select("id, body, member_id, created_at").eq("contact_id", id).order("created_at", { ascending: false });
    setNotes(n ?? []);
  }, [id, sb]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    callFunction<{ bookings: Booking[] }>("tb-webhook", { action: "contact_bookings", contact_id: id })
      .then((r) => setBookings(r.bookings))
      .catch((e) => setTbMsg((e as Error).message));
  }, [id]);

  if (!c || !dir) return <div className="p-8 text-sm text-muted">Loading…</div>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await sb.from("contacts").update({
      name: c!.name, email: c!.email, state: c!.state, owner_member_id: c!.owner_member_id, opt_in: c!.opt_in,
      opt_in_at: c!.opt_in ? c!.opt_in_at ?? new Date().toISOString() : null, opt_in_source: c!.opt_in ? c!.opt_in_source ?? "staff" : null,
    }).eq("id", c!.id);
    setSaved(error ? error.message : "Saved");
    setTimeout(() => setSaved(""), 2500);
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await sb.from("notes").insert({ company_id: me.company_id, contact_id: id, member_id: me.member_id, body: newNote.trim() });
    setNewNote("");
    load();
  }

  const conv = convs[0];
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted"><Link href="/contacts">Contacts</Link> / Profile</p>
          <h1 className="text-2xl font-bold">{c.name ?? formatPhone(c.wa_id)}</h1>
        </div>
        <div className="flex gap-2">
          {conv ? <Link href={`/inbox?c=${conv.id}`} className="inline-flex h-10 items-center rounded-lg border border-input bg-white px-4 text-sm font-semibold text-body no-underline">Open chat</Link> : null}
        </div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Details" />
            <form onSubmit={save} className="grid gap-3 p-5 sm:grid-cols-2">
              <Field label="Name" htmlFor="p1"><Input id="p1" value={c.name ?? ""} disabled={!canEdit} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
              <Field label="WhatsApp" htmlFor="p2"><Input id="p2" value={formatPhone(c.wa_id)} disabled /></Field>
              <Field label="Email" htmlFor="p3"><Input id="p3" value={c.email ?? ""} placeholder="None yet" disabled={!canEdit} onChange={(e) => setC({ ...c, email: e.target.value || null })} /></Field>
              <Field label="State" htmlFor="p4"><Input id="p4" value={c.state ?? ""} disabled={!canEdit} onChange={(e) => setC({ ...c, state: e.target.value || null })} /></Field>
              <Field label="Stage" htmlFor="p5"><Input id="p5" value={conv ? stageLabel(conv.stage) : "–"} disabled /></Field>
              <Field label="Owner" htmlFor="p6">
                <Select id="p6" value={c.owner_member_id ?? ""} disabled={!canEdit} onChange={(e) => setC({ ...c, owner_member_id: e.target.value || null })}>
                  <option value="">Nobody</option>{dir.members.filter((m) => m.role !== "accounts").map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </Select>
              </Field>
              <label className="col-span-full flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.opt_in && !c.opted_out_at} disabled={!canEdit || !!c.opted_out_at} onChange={(e) => setC({ ...c, opt_in: e.target.checked })} />
                Agreed to receive promotions (opt-in){c.opt_in_source ? <span className="text-muted"> · source: {c.opt_in_source}{c.opt_in_at ? `, ${fmtDate(c.opt_in_at)}` : ""}</span> : null}
              </label>
              {c.opted_out_at ? <p className="col-span-full text-sm text-danger">Opted out on {fmtDate(c.opted_out_at)} (replied STOP). No broadcasts or marketing templates.</p> : null}
              {canEdit ? <div className="col-span-full flex items-center gap-3"><Button type="submit">Save</Button>{saved ? <span role="status" className="text-sm text-muted">{saved}</span> : null}</div> : null}
            </form>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <ol className="flex flex-col gap-3 p-5">
              {timeline.length === 0 ? <li className="text-sm text-muted">No activity yet.</li> : null}
              {timeline.map((t, i) => (
                <li key={i} className="flex justify-between gap-3 border-l-2 border-line pl-3 text-sm"><span>{t.title}</span><span className="shrink-0 text-xs text-muted">{t.when}</span></li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="TravelBoost bookings" />
            <div className="flex flex-col gap-4 p-5 text-sm">
              {bookings === null && !tbMsg ? <p className="text-muted">Loading bookings…</p> : null}
              {tbMsg ? <p className="text-muted">Bookings unavailable: {tbMsg}</p> : null}
              {bookings?.length === 0 ? <p className="text-muted">No bookings in TravelBoost for this number.</p> : null}
              {bookings?.map((b) => (
                <div key={b.id} className="flex flex-col gap-2 rounded-lg border border-line p-4">
                  <div className="flex justify-between"><strong>{b.product_name}</strong><span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">{b.status}</span></div>
                  <Row k="Booking no." v={b.id} /><Row k="Date" v={`${fmtDate(b.start_date)} – ${fmtDate(b.end_date)}`} />
                  <Row k="Pax" v={`${b.pax.adults} adults${b.pax.children ? `, ${b.pax.children} children` : ""}${b.pax.infants ? `, ${b.pax.infants} infants` : ""}`} />
                  <Row k="Paid" v={rm(b.deposit_paid)} /><Row k="Balance" v={`${rm(b.balance)}${b.balance_due ? ` · due ${fmtDate(b.balance_due)}` : ""}`} />
                  <p className="mt-1 text-xs font-semibold text-muted">Pax and passports</p>
                  {b.passengers.map((p, i) => <Row key={i} k={`${p.name}${p.is_lead ? " (lead guest)" : ""}`} v={p.passport_received ? "Received" : "Not yet"} />)}
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Notes" />
            <div className="flex flex-col gap-3 p-5">
              {notes.map((n) => <p key={n.id} className="text-sm"><strong>{dir.member(n.member_id)?.display_name}:</strong> {n.body} <span className="text-xs text-muted">{fmtDate(n.created_at)}</span></p>)}
              <Field label="New note" htmlFor="nn"><Textarea id="nn" rows={2} placeholder="Add a note for other staff" value={newNote} onChange={(e) => setNewNote(e.target.value)} /></Field>
              <div><Button size="sm" onClick={addNote} disabled={!newNote.trim()}>Add note</Button></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
