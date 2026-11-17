import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { MockTravelBoost, mockDates } from "../_shared/providers/travelboost.ts";
import { COMPANY, conversationFor, ensureFunctionsServer, inboundPayload, randomWaId, signedRequest, testOpts } from "../_shared/testing.ts";
import { handler as webhook } from "../wa-webhook/handler.ts";
import { handler, signTravelBoost } from "./handler.ts";

Deno.test("mock catalogue matches the brief (KK RM1,399–1,649, 1–16 seats; Semporna RM1,890)", () => {
  const kk = mockDates().filter((d) => d.product_id === "tb-kk-kundasang");
  assert(kk.every((d) => d.price_adult >= 1399 && d.price_adult <= 1649 && d.base >= 1 && d.base <= 16));
  assert(mockDates().filter((d) => d.product_id === "tb-semporna").every((d) => d.price_adult === 1890));
  assert(kk.filter((d) => d.start_date.startsWith("2027")).length > 53);
});

Deno.test("search: never more than 8 rows, enough seats first", testOpts, async () => {
  const tb = new MockTravelBoost(COMPANY);
  const all = await tb.searchProducts({ destination: "kundasang", pax: 2 });
  assertEquals(all.rows.length, 8);
  assert(all.total > 8);
  const mar = await tb.searchProducts({ destination: "Kundasang", month: "2027-03", pax: 9 });
  const firstShort = mar.rows.findIndex((r) => r.available < 9);
  assert(firstShort === -1 || mar.rows.slice(firstShort).every((r) => r.available < 9));
  assert(mar.rows.every((r) => r.start_date.startsWith("2027-03")));
});

Deno.test("tb-webhook: signature, exactly-once, seat.locked → needs staff, payment → deposit + after-sales", testOpts, async () => {
  await ensureFunctionsServer();
  const from = randomWaId();
  await webhook(await signedRequest("http://x/wa-webhook", inboundPayload({ from, text: "Kundasang" }))).then((r) => r.body?.cancel());
  const { conv } = await conversationFor(from);
  const tb = new MockTravelBoost(COMPANY);
  const lock = await tb.createLockLink({ group_id: (await tb.searchProducts({ destination: "kundasang", month: "2027-05", pax: 1 })).rows[0].group_id, pax: 1, lead_name: "Puan Test", lead_phone: from });
  const booking = await tb.completeLock(lock.lock_id);

  const send = async (event: unknown, sig?: string) => {
    const body = JSON.stringify(event);
    return await handler(new Request(`http://x/tb-webhook?company=${COMPANY}`, { method: "POST", body, headers: { "x-travelboost-signature": sig ?? await signTravelBoost(body) } }));
  };
  const ev = { id: `evt_${crypto.randomUUID()}`, type: "seat.locked", created_at: new Date().toISOString(), data: { booking_id: booking.id, lead_phone: from, pax: 1, start_date: booking.start_date } };
  assertEquals((await send(ev, "sha256=bad")).status, 401);
  assertEquals((await (await send(ev)).json()).matched, true);
  assertEquals((await (await send(ev)).json()).duplicate, true);
  const { data: c1 } = await db().from("conversations").select("stage, needs_staff, needs_staff_reason, booking_ref").eq("id", conv.id).single();
  assertEquals(c1!.stage, "booking");
  assert(c1!.needs_staff && c1!.needs_staff_reason!.includes("send payment link"));

  const inv = await tb.recordPayment(booking.invoice_id, { amount: booking.deposit_amount, paid_at: new Date().toISOString(), reference: "T1", method: "transfer" });
  await send({ id: `evt_${crypto.randomUUID()}`, type: "payment.recorded", created_at: new Date().toISOString(), data: { booking_id: booking.id, paid: inv.paid, balance: inv.balance, amount: booking.deposit_amount, start_date: booking.start_date } });
  const { data: c2 } = await db().from("conversations").select("stage, trip_date").eq("id", conv.id).single();
  assertEquals(c2!.stage, "deposit");
  const { data: jobs } = await db().from("followup_jobs").select("step_key").eq("conversation_id", conv.id).eq("kind", "aftersales");
  assert((jobs ?? []).some((j) => j.step_key === "aftersales:on_deposit"));
  assert((jobs ?? []).some((j) => j.step_key === "aftersales:d7_final"));
});
