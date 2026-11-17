"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/shell/me-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Card, CardHeader, Empty, Stat } from "@/components/ui/misc";
import { callFunction } from "@/lib/functions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, fmtDate, fmtTime, rm, timeAgo } from "@/lib/utils";

interface PV {
  id: string; booking_ref: string | null; invoice_amount: number | null; lead_guest_name: string | null; receipt_media_path: string | null;
  receipt_amount: number | null; receipt_date: string | null; receipt_reference: string | null; receipt_sender: string | null; edited_suspect: boolean;
  bank_email: { amount: number | null; date: string | null; reference: string | null; senderName: string | null; fromAddress: string } | null;
  match: { checks?: Record<string, boolean>; reasons?: string[]; mismatches?: string[] }; ai_opinion: string | null; reason: string | null; status: string;
  created_at: string; verified_at: string | null; conversation_id: string | null; contact: { name: string | null; wa_id: string } | null;
}

function Receipt({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (path) supabaseBrowser().storage.from("media").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  if (!path) return <p className="text-sm text-muted">No file</p>;
  if (!url) return <p className="text-sm text-muted">Loading…</p>;
  return path.endsWith(".pdf") ? <a href={url} target="_blank" rel="noreferrer">Open receipt PDF</a> : <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Receipt sent in chat" className="max-h-72 rounded-lg border border-line" /></a>;
}

export function PaymentsApp() {
  const me = useMe();
  const canAct = me.role === "owner" || me.role === "accounts";
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<PV[]>([]);
  const [done, setDone] = useState<PV[]>([]);
  const [inbox, setInbox] = useState<{ status: string; email: string | null; last_synced_at: string | null } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const sel = "*, contact:contacts(name, wa_id)";
    const { data } = await sb.from("payment_verifications").select(sel).in("status", ["pending", "asked_customer"]).order("created_at");
    setRows((data ?? []) as PV[]);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data: d } = await sb.from("payment_verifications").select(sel).in("status", ["verified", "auto_verified", "rejected"]).gte("verified_at", new Date(Date.now() - 7 * 86400000).toISOString()).order("verified_at", { ascending: false }).limit(50);
    setDone((d ?? []) as PV[]);
    const { data: s } = await sb.rpc("rpc_bank_inbox_state");
    setInbox(s);
  }, [sb]);
  useEffect(() => {
    load();
    const ch = sb.channel("payments").on("postgres_changes", { event: "*", schema: "public", table: "payment_verifications" }, load).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load, sb]);

  async function decide(p: PV, decision: "verify" | "ask" | "reject") {
    setBusy(p.id + decision);
    setMsg("");
    try {
      await callFunction("bank-email-poller", { action: "decide", verification_id: p.id, decision, note: notes[p.id] ?? "" });
      setMsg(decision === "verify" ? `Verified ${p.booking_ref}. TravelBoost updated and the customer got an official receipt.` : decision === "ask" ? "Asked the customer for a clearer receipt." : "Rejected; the chat is flagged for staff.");
    } catch (e) { setMsg((e as Error).message); }
    setBusy("");
    load();
  }

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const autoToday = done.filter((d) => d.status === "auto_verified" && d.verified_at && Date.parse(d.verified_at) >= startOfToday.getTime()).length;
  const waiting = rows.filter((r) => !r.bank_email && r.status === "pending").length;

  const cell = (ok: boolean | undefined, v: React.ReactNode) => <td className={cn("px-3 py-2", ok === false && "bg-danger-soft font-semibold text-danger")}>{v ?? "–"}</td>;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payment verification</h1>
          <p className="mt-1 text-sm text-muted">{inbox?.status === "connected" ? "AI checks bank notification emails every 5 minutes and matches them with receipts in chat. Anything that doesn't fully match comes here." : "Bank email is not connected: accounts verifies every receipt here."}</p>
        </div>
        <p className="text-sm text-muted">{inbox?.last_synced_at ? `Bank email: last checked ${timeAgo(inbox.last_synced_at)} ago` : "Bank email: not checked yet"}</p>
      </header>
      {msg ? <p role="status" className="rounded-lg bg-panel px-3 py-2 text-sm">{msg}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Auto-verified today" value={autoToday} />
        <Stat label="Needs accounts review" value={rows.length} tone={rows.length ? "warn" : undefined} />
        <Stat label="Receipt received, bank email not in yet" value={waiting} sub="normal for other banks, 1–2 working days" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <h2 className="font-semibold">Needs accounts review</h2>
          {rows.length === 0 ? <Card><Empty title="Nothing to review" /></Card> : null}
          {rows.map((p) => {
            const c = p.match?.checks ?? {};
            const amountOk = p.receipt_amount === null || p.invoice_amount === null ? undefined : Math.abs(Number(p.receipt_amount) - Number(p.invoice_amount)) < 0.005 && (p.bank_email ? c.amount !== false : true);
            return (
              <Card key={p.id} className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
                <div className="flex flex-col gap-2"><p className="text-xs font-semibold text-muted">Receipt from chat · {rm(p.receipt_amount)}</p><Receipt path={p.receipt_media_path} /></div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{p.contact?.name ?? p.lead_guest_name} · {p.booking_ref}</p>
                    <div className="flex gap-1">{p.edited_suspect ? <Badge tone="danger">Looks edited</Badge> : null}{p.status === "asked_customer" ? <Badge tone="warn">Asked customer</Badge> : null}{!p.bank_email ? <Badge>No bank email yet</Badge> : null}</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead className="text-xs text-muted"><tr><th className="px-3 py-1" /><th className="px-3 py-1">Invoice</th><th className="px-3 py-1">Receipt</th><th className="px-3 py-1">Bank email</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        <tr><td className="px-3 py-2 text-muted">Amount</td><td className="px-3 py-2">{rm(p.invoice_amount)}</td>{cell(amountOk, rm(p.receipt_amount))}{cell(p.bank_email ? c.amount : undefined, p.bank_email ? rm(p.bank_email.amount) : null)}</tr>
                        <tr><td className="px-3 py-2 text-muted">Name</td><td className="px-3 py-2">{p.lead_guest_name ?? "–"}</td>{cell(undefined, p.receipt_sender)}{cell(p.bank_email ? c.reference_or_name : undefined, p.bank_email?.senderName)}</tr>
                        <tr><td className="px-3 py-2 text-muted">Reference</td><td className="px-3 py-2">{p.booking_ref ?? "–"}</td>{cell(undefined, p.receipt_reference)}{cell(p.bank_email ? c.reference_or_name : undefined, p.bank_email?.reference)}</tr>
                        <tr><td className="px-3 py-2 text-muted">Date</td><td className="px-3 py-2">–</td>{cell(undefined, p.receipt_date)}{cell(p.bank_email ? c.date : undefined, p.bank_email?.date)}</tr>
                        {p.bank_email ? <tr><td className="px-3 py-2 text-muted">Sender</td><td /><td />{cell(c.trusted_sender, p.bank_email.fromAddress)}</tr> : null}
                      </tbody>
                    </table>
                  </div>
                  {p.reason ? <p className="text-sm text-warn-ink"><strong>Why it&apos;s here:</strong> {p.reason}</p> : null}
                  {p.ai_opinion ? <p className="text-sm text-body"><strong>AI opinion:</strong> {p.ai_opinion}</p> : null}
                  {canAct ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input aria-label="Note to the customer (optional)" placeholder="Note (optional)" className="h-10 max-w-64" value={notes[p.id] ?? ""} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                      <Button onClick={() => decide(p, "verify")} disabled={!!busy}>Verify payment</Button>
                      <Button variant="secondary" onClick={() => decide(p, "ask")} disabled={!!busy}>Ask customer</Button>
                      <Button variant="ghost" onClick={() => decide(p, "reject")} disabled={!!busy}>Reject</Button>
                    </div>
                  ) : <p className="text-xs text-muted">View only: owner or accounts verify payments.</p>}
                </div>
              </Card>
            );
          })}
          <Card>
            <CardHeader title="Last 7 days" />
            <ul className="divide-y divide-line">
              {done.map((d) => (
                <li key={d.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>{d.contact?.name ?? d.lead_guest_name} · {d.booking_ref} · {rm(d.receipt_amount ?? d.invoice_amount)}</span>
                  <span className={d.status === "rejected" ? "text-danger" : "text-success"}>{d.status.replace("_", " ")} · {fmtDate(d.verified_at)} {fmtTime(d.verified_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <aside className="flex flex-col gap-4 text-sm">
          <Card className="p-5"><h2 className="font-semibold">When the AI verifies on its own</h2><p className="mt-1 text-muted">Everything must match. One mismatch = goes to accounts.</p>
            <ol className="mt-2 list-decimal pl-5"><li>Amount in the bank email exactly matches the invoice</li><li>Date within 3 days of the receipt</li><li>Reference contains the booking number, or sender name matches the lead guest</li><li>Email comes from a trusted bank address</li><li>The receipt doesn&apos;t look edited</li></ol></Card>
          <Card className="p-5"><h2 className="font-semibold">After verification</h2><p className="mt-1">TravelBoost invoice updated<br />Customer stage becomes Deposit (or Full payment)<br />Agent switches to after-sales mode<br />Customer gets an official receipt in chat</p></Card>
          <Card className="p-5"><h2 className="font-semibold">Email source</h2><p className="mt-1">{inbox?.email ?? "Not connected"}</p><p className="text-xs text-muted">Read-only. The AI can&apos;t send or delete emails.</p></Card>
        </aside>
      </div>
    </div>
  );
}
