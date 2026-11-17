import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { parseBankEmail, pollBankEmails, receiptFromMessage } from "../_shared/payments.ts";
import { MockTravelBoost } from "../_shared/providers/travelboost.ts";
import { COMPANY, conversationFor, ensureFunctionsServer, inboundPayload, randomWaId, signedRequest, testOpts } from "../_shared/testing.ts";
import { handler as webhook } from "../wa-webhook/handler.ts";

Deno.test("bank email parser (Maybank-style alert)", () => {
  const f = parseBankEmail({ raw_id: "x", from: "alerts@maybank.com.my", subject: "You've received money", received_at: "2026-11-17T03:00:00Z",
    text: "Amount: RM600.00\nDate: 17/11/2026\nSender name: AMINAH BINTI YUSOF\nRecipient reference: MTB-10234 deposit\n" });
  assertEquals(f.amount, 600);
  assertEquals(f.date, "2026-11-17");
  assertEquals(f.senderName, "AMINAH BINTI YUSOF");
  assert(f.reference!.includes("MTB-10234"));
});

async function bookedChat() {
  await ensureFunctionsServer();
  const from = randomWaId();
  await webhook(await signedRequest("http://x/wa-webhook", inboundPayload({ from, text: "Kundasang" }))).then((r) => r.body?.cancel());
  const { conv } = await conversationFor(from);
  const tb = new MockTravelBoost(COMPANY);
  const date = (await tb.searchProducts({ destination: "kundasang", month: "2027-06", pax: 2 })).rows[0];
  const lock = await tb.createLockLink({ group_id: date.group_id, pax: 2, lead_name: "Aminah binti Yusof", lead_phone: from });
  const booking = await tb.completeLock(lock.lock_id);
  await db().from("conversations").update({ booking_ref: booking.id, stage: "booking" }).eq("id", conv.id);
  return { conv, booking };
}
async function receipt(convId: string, caption: string) {
  const path = `${COMPANY}/inbound/test-${crypto.randomUUID()}.jpg`;
  await db().storage.from("media").upload(path, new Uint8Array([255, 216, 255]), { contentType: "image/jpeg" });
  const { data: m } = await db().from("messages").insert({ company_id: COMPANY, conversation_id: convId, direction: "in", sender_type: "customer", type: "image", body: caption, media_path: path, media_mime: "image/jpeg", status: "received" }).select("id").single();
  return await receiptFromMessage(m!.id);
}
async function bankEmail(amount: number, ref: string, from = "alerts@maybank.com.my") {
  await db().from("mock_state").insert({ company_id: COMPANY, kind: "bank_email", ref: `mail-${crypto.randomUUID()}`, data: {
    from, subject: "Fund transfer received", received_at: new Date().toISOString(),
    text: `Amount: RM${amount.toFixed(2)}\nDate: ${new Date().toISOString().slice(0, 10)}\nSender name: SOMEONE ELSE\nRecipient reference: ${ref}` } });
}

Deno.test("receipt + matching bank email → auto-verified, TravelBoost paid, stage Deposit, official receipt", testOpts, async () => {
  const { conv, booking } = await bookedChat();
  const id = await receipt(conv.id, `Resit RM${booking.deposit_amount} ${booking.id}`);
  const { data: p1 } = await db().from("payment_verifications").select("status, invoice_amount").eq("id", id).single();
  assertEquals(p1!.status, "pending");
  assertEquals(Number(p1!.invoice_amount), booking.deposit_amount);
  await bankEmail(booking.deposit_amount, `${booking.id} deposit`);
  const r = await pollBankEmails(COMPANY);
  assert(r.verified >= 1);
  const { data: p2 } = await db().from("payment_verifications").select("status").eq("id", id).single();
  assertEquals(p2!.status, "auto_verified");
  const { data: c } = await db().from("conversations").select("stage").eq("id", conv.id).single();
  assertEquals(c!.stage, "deposit");
  const b2 = await new MockTravelBoost(COMPANY).getBooking(booking.id);
  assertEquals(b2!.paid, booking.deposit_amount);
  const { data: out } = await db().from("messages").select("body").eq("conversation_id", conv.id).eq("direction", "out").ilike("body", "%telah disahkan%");
  assertEquals(out!.length, 1);
  // a second poll does not store the same email twice
  assertEquals((await pollBankEmails(COMPANY)).stored, 0);
});

Deno.test("never auto-verify: wrong amount, untrusted sender, or an edited receipt", testOpts, async () => {
  const a = await bookedChat();
  const idA = await receipt(a.conv.id, `Resit RM${a.booking.deposit_amount} ${a.booking.id}`);
  await bankEmail(a.booking.deposit_amount, `${a.booking.id}`, "fake@gmail.com");
  const b = await bookedChat();
  const idB = await receipt(b.conv.id, `Resit edit RM${b.booking.deposit_amount} ${b.booking.id}`);
  await bankEmail(b.booking.deposit_amount, `${b.booking.id}`);
  await pollBankEmails(COMPANY);
  const { data } = await db().from("payment_verifications").select("id, status, reason").in("id", [idA!, idB!]);
  assert(data!.every((x) => x.status === "pending"), JSON.stringify(data));
  assert(/not a trusted address|does not contain the booking number/.test(data!.find((x) => x.id === idA)!.reason!));
  assert(data!.find((x) => x.id === idB)!.reason!.includes("edited"));
});
