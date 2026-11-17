// Payment verification (section 9): receipt reading, bank email parsing, auto-verify, verify/reject.
import { autoVerify, type BankEmailFacts, type ReceiptFacts } from "./core/rules.ts";
import { db } from "./db.ts";
import { sendViaGateway } from "./functions.ts";
import { getIntegration } from "./integrations.ts";
import { onPaymentRecorded } from "./ai/lifecycle.ts";
import { jsonOf, modelFor } from "./ai/model.ts";
import { addClaudeSpend, modelName } from "./ai/orchestrator.ts";
import { bankProviderFor, type RawBankEmail } from "./providers/others.ts";
import { travelBoostFor } from "./providers/travelboost.ts";

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export interface ReceiptRead extends ReceiptFacts { is_receipt: boolean; bank: string | null; edited_reasons: string[]; opinion: string }

/** Parse "RM 1,200.50" / "MYR600" style amounts. */
export function parseAmount(text: string): number | null {
  const m = text.match(/(?:RM|MYR)\s?([\d,]+(?:\.\d{1,2})?)/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Mock receipt reader: reads the caption (e.g. "Resit RM600 ref MTB-10234"). */
function mockReceipt(caption: string, fallbackAmount: number | null): ReceiptRead {
  const amount = parseAmount(caption) ?? fallbackAmount;
  return {
    is_receipt: true, amount, date: new Date().toISOString().slice(0, 10), reference: caption.match(/MTB-\d+/i)?.[0] ?? null,
    sender: caption.match(/(?:dari|from)\s+([A-Za-z ]+)/i)?.[1]?.trim() ?? null, bank: "Maybank", editedSuspect: /edit|palsu|fake/i.test(caption),
    edited_reasons: /edit|palsu|fake/i.test(caption) ? ["Caption suggests the image was edited"] : [], opinion: "Mock reading from the caption; check the image yourself.",
  };
}

export async function readReceipt(companyId: string, mediaPath: string, mime: string, caption: string, fallbackAmount: number | null): Promise<ReceiptRead> {
  const model = await modelFor(companyId);
  if (!model || model.mode === "mock") return mockReceipt(caption, fallbackAmount);
  const { data: file } = await db().storage.from("media").download(mediaPath);
  if (!file) throw new Error("receipt file missing");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const block = mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } }
    : { type: "image", source: { type: "base64", media_type: mime, data: b64(bytes) } };
  const { data: co } = await db().from("companies").select("settings").eq("id", companyId).single();
  const res = await model.call({
    purpose: "receipt", model: modelName(co?.settings ?? {}, "chat"), maxTokens: 2000, effort: "medium",
    system: [{ type: "text", text: "You read Malaysian bank transfer receipts (DuitNow, IBG, JomPAY, online banking screenshots). Extract facts exactly as shown. Flag signs of editing: inconsistent fonts, misaligned or differently sized digits, amounts that don't match elsewhere on the receipt, missing transaction IDs. JSON only." }],
    messages: [{ role: "user", content: [block as never, { type: "text", text: `Customer caption: ${caption || "(none)"}` }] }],
    jsonSchema: { type: "object", additionalProperties: false, required: ["is_receipt", "amount", "date", "reference", "sender", "bank", "edited_suspect", "edited_reasons", "opinion"], properties: {
      is_receipt: { type: "boolean" }, amount: { type: ["number", "null"] }, date: { type: ["string", "null"], description: "YYYY-MM-DD" }, reference: { type: ["string", "null"] },
      sender: { type: ["string", "null"] }, bank: { type: ["string", "null"] }, edited_suspect: { type: "boolean" }, edited_reasons: { type: "array", items: { type: "string" } }, opinion: { type: "string" } } },
  });
  await addClaudeSpend(companyId, res.costUsd);
  await db().from("ai_runs").insert({ company_id: companyId, purpose: "receipt", model: res.model, input_tokens: res.usage.input, output_tokens: res.usage.output, cost: res.costUsd, decision: "none" });
  const j = jsonOf<any>(res.content) ?? {};
  return { is_receipt: !!j.is_receipt, amount: j.amount ?? null, date: j.date ?? null, reference: j.reference ?? null, sender: j.sender ?? null, bank: j.bank ?? null,
    editedSuspect: !!j.edited_suspect, edited_reasons: j.edited_reasons ?? [], opinion: j.opinion ?? "" };
}

/** Bank notification email → facts (Maybank/CIMB/RHB/Public Bank style alerts). */
export function parseBankEmail(e: RawBankEmail): BankEmailFacts {
  const t = `${e.subject}\n${e.text}`;
  const date = t.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? (() => {
    const m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : e.received_at.slice(0, 10);
  })();
  return {
    amount: parseAmount(t), date,
    reference: t.match(/(?:reference|ref(?:erence)?\s*(?:no\.?)?|recipient reference|payment details|keterangan)\s*[:\-]\s*([^\n]+)/i)?.[1]?.trim() ?? null,
    senderName: t.match(/(?:from|sender|daripada|pengirim|payer)(?:\s*name)?\s*[:\-]\s*([^\n]+?)(?:\s{2,}|\n|$)/i)?.[1]?.trim() ?? null,
    fromAddress: e.from,
  };
}

/** A customer sent an image/PDF in a chat that has a booking → read it and open a verification. */
export async function receiptFromMessage(messageId: string): Promise<string | null> {
  const { data: m } = await db().from("messages").select("id, company_id, conversation_id, media_path, media_mime, body").eq("id", messageId).single();
  if (!m?.media_path) return null;
  const { data: conv } = await db().from("conversations").select("id, company_id, contact_id, booking_ref, stage, holder_member_id").eq("id", m.conversation_id).single();
  if (!conv?.booking_ref || !["booking", "deposit", "full_payment"].includes(conv.stage)) return null;
  const tb = await travelBoostFor(conv.company_id);
  const booking = await tb.getBooking(conv.booking_ref).catch(() => null);
  const invoice = booking ? await tb.getInvoice(booking.invoice_id).catch(() => null) : null;
  const expected = invoice ? (invoice.paid < invoice.deposit_amount ? invoice.deposit_amount - invoice.paid : invoice.balance) : null;
  const r = await readReceipt(conv.company_id, m.media_path, m.media_mime ?? "image/jpeg", m.body ?? "", expected);
  if (!r.is_receipt) return null;
  const mismatches: string[] = [];
  if (expected !== null && r.amount !== null && Math.abs(r.amount - expected) > 0.005) mismatches.push(`Receipt RM${r.amount} vs expected RM${expected}`);
  if (r.editedSuspect) mismatches.push(`Receipt may be edited: ${r.edited_reasons.join("; ") || "suspicious"}`);
  const { data: pv } = await db().from("payment_verifications").insert({
    company_id: conv.company_id, conversation_id: conv.id, contact_id: conv.contact_id, message_id: m.id, booking_ref: conv.booking_ref,
    invoice_id: invoice?.id ?? booking?.invoice_id ?? null, invoice_amount: expected, lead_guest_name: booking?.lead_name ?? null,
    receipt_media_path: m.media_path, receipt_amount: r.amount, receipt_date: r.date, receipt_reference: r.reference, receipt_sender: r.sender,
    edited_suspect: r.editedSuspect, ai_opinion: r.opinion, match: { mismatches }, reason: mismatches.join("; ") || "Waiting for the bank email",
  }).select("id").single();
  await db().rpc("add_system_event", { p_conv: conv.id, p_body: `Receipt received · RM${r.amount ?? "?"} · waiting for verification`, p_meta: { kind: "payment", verification_id: pv!.id } });
  const ok = await tryAutoVerify(pv!.id);
  if (!ok) {
    const { data: accounts } = await db().from("members").select("id").eq("company_id", conv.company_id).in("role", ["owner", "accounts"]).eq("status", "active");
    for (const a of accounts ?? []) await db().rpc("notify_member", { p_member: a.id, p_event: "receipt_review", p_title: "A receipt needs review", p_body: `${conv.booking_ref} · RM${r.amount ?? "?"}`, p_link: "/payments" });
  }
  return pv!.id;
}

/** Match a pending verification with stored bank emails. Auto-verifies only when every rule holds. */
export async function tryAutoVerify(verificationId: string): Promise<boolean> {
  const { data: pv } = await db().from("payment_verifications").select("*").eq("id", verificationId).single();
  if (!pv || pv.status !== "pending" || pv.invoice_amount === null) return false;
  const integ = await getIntegration(pv.company_id, "bank_email");
  const trusted = String(integ.config.trusted_senders ?? Deno.env.get("MOCK_TRUSTED_BANK_SENDER") ?? "alerts@maybank.com.my").split(",").map((s) => s.trim()).filter(Boolean);
  const { data: emails } = await db().from("bank_emails").select("*").eq("company_id", pv.company_id).is("matched_verification_id", null).order("received_at", { ascending: false }).limit(200);
  const receipt: ReceiptFacts = { amount: pv.receipt_amount, date: pv.receipt_date, reference: pv.receipt_reference, sender: pv.receipt_sender, editedSuspect: pv.edited_suspect };
  let best: { email: any; result: ReturnType<typeof autoVerify> } | null = null;
  for (const e of emails ?? []) {
    const facts = e.parsed as BankEmailFacts;
    if (facts.amount === null || Math.abs(facts.amount - Number(pv.invoice_amount)) > 0.005) continue;
    const result = autoVerify({ amount: Number(pv.invoice_amount), bookingRef: pv.booking_ref ?? "", leadGuestName: pv.lead_guest_name }, receipt, facts, trusted);
    if (!best || Object.values(result.checks).filter(Boolean).length > Object.values(best.result.checks).filter(Boolean).length) best = { email: e, result };
    if (result.ok) break;
  }
  if (!best) return false;
  await db().from("payment_verifications").update({ bank_email: best.email.parsed, match: { ...pv.match, checks: best.result.checks, reasons: best.result.reasons },
    reason: best.result.ok ? null : best.result.reasons.join("; ") }).eq("id", pv.id);
  if (!best.result.ok) return false;
  await db().from("bank_emails").update({ matched_verification_id: pv.id }).eq("id", best.email.id);
  await verifyPayment(pv.id, null, "auto_verified");
  return true;
}

/** Verification side effects: TravelBoost payment, stage switch (agent → after-sales), official receipt, event. */
export async function verifyPayment(verificationId: string, memberId: string | null, status: "verified" | "auto_verified" = "verified") {
  const { data: pv } = await db().from("payment_verifications").select("*").eq("id", verificationId).single();
  if (!pv || !["pending", "asked_customer"].includes(pv.status)) throw new Error("not_pending");
  const amount = Number(pv.receipt_amount ?? pv.invoice_amount);
  const tb = await travelBoostFor(pv.company_id);
  const invoice = pv.invoice_id ? await tb.recordPayment(pv.invoice_id, { amount, paid_at: new Date().toISOString(), reference: pv.receipt_reference ?? pv.id, method: "bank_transfer" }) : null;
  await db().from("payment_verifications").update({ status, verified_by: memberId, verified_at: new Date().toISOString() }).eq("id", pv.id);
  const booking = pv.booking_ref ? await tb.getBooking(pv.booking_ref) : null;
  if (pv.conversation_id) {
    await onPaymentRecorded(pv.conversation_id, { bookingId: pv.booking_ref, paid: invoice?.paid ?? amount, balance: invoice?.balance ?? 0, amount, startDate: booking?.start_date ?? null });
    const due = invoice?.due_date ? new Date(invoice.due_date).toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" }) : null;
    const body = `Terima kasih cik. Bayaran RM${amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })} untuk tempahan ${pv.booking_ref} telah disahkan pada ${new Date().toLocaleDateString("ms-MY", { day: "numeric", month: "long", year: "numeric" })}.` +
      (invoice && invoice.balance > 0 ? ` Baki RM${invoice.balance.toLocaleString("en-MY", { minimumFractionDigits: 2 })}${due ? ` perlu dijelaskan sebelum ${due}` : ""}.` : " Tempahan cik telah dibayar penuh.") +
      " Ada apa-apa lagi yang kami boleh bantu?";
    await sendViaGateway({ conversation_id: pv.conversation_id, kind: "text", sender_type: "system", purpose: "system", body });
  }
  await db().from("events").insert({ company_id: pv.company_id, actor_type: memberId ? "staff" : "ai", actor_member_id: memberId, action: status === "auto_verified" ? "payment_auto_verified" : "payment_verified",
    entity: "payment_verifications", entity_id: pv.id, after: { booking_ref: pv.booking_ref, amount, invoice_balance: invoice?.balance ?? null } });
}

export async function rejectPayment(verificationId: string, memberId: string, decision: "rejected" | "asked_customer", note: string) {
  const { data: pv } = await db().from("payment_verifications").select("*").eq("id", verificationId).single();
  if (!pv) throw new Error("not_found");
  await db().from("payment_verifications").update({ status: decision, verified_by: memberId, verified_at: new Date().toISOString(), reason: note || pv.reason }).eq("id", pv.id);
  if (pv.conversation_id) {
    const body = decision === "asked_customer"
      ? `Terima kasih cik. Untuk sahkan bayaran ${pv.booking_ref}, boleh cik hantar semula resit yang jelas${note ? ` (${note})` : ""}? Pastikan jumlah, tarikh dan nombor rujukan kelihatan.`
      : `Maaf cik, kami belum dapat mengesahkan resit untuk tempahan ${pv.booking_ref}${note ? `: ${note}` : ""}. Staf kami akan menghubungi cik.`;
    await sendViaGateway({ conversation_id: pv.conversation_id, kind: "text", sender_type: "system", purpose: "system", body });
    if (decision === "rejected") await db().rpc("set_needs_staff", { p_conv: pv.conversation_id, p_reason: `Receipt rejected by accounts: ${note || "see payment verification"}` });
  }
  await db().from("events").insert({ company_id: pv.company_id, actor_member_id: memberId, action: `payment_${decision}`, entity: "payment_verifications", entity_id: pv.id, after: { note } });
}

/** IMAP (or mock) poll: store new bank emails exactly once, then try to match pending receipts. */
export async function pollBankEmails(companyId: string): Promise<{ fetched: number; stored: number; verified: number }> {
  const provider = await bankProviderFor(companyId);
  if (!provider) return { fetched: 0, stored: 0, verified: 0 };
  const emails = await provider.fetchSince(new Date(Date.now() - 4 * 86400000));
  let stored = 0;
  for (const e of emails) {
    const { error } = await db().from("bank_emails").insert({ company_id: companyId, raw_id: e.raw_id, from_address: e.from, subject: e.subject, received_at: e.received_at, parsed: parseBankEmail(e) });
    if (!error) stored++;
  }
  await db().from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("company_id", companyId).eq("key", "bank_email");
  let verified = 0;
  const { data: pending } = await db().from("payment_verifications").select("id").eq("company_id", companyId).eq("status", "pending");
  for (const p of pending ?? []) if (await tryAutoVerify(p.id)) verified++;
  return { fetched: emails.length, stored, verified };
}
