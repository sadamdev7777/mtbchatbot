import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { conversationFor, ensureFunctionsServer, inboundPayload, randomWaId, signedRequest, statusPayload, testOpts } from "../_shared/testing.ts";
import { handler } from "./handler.ts";
import { gatewaySend } from "../wa-send/send.ts";

const URL_ = "http://localhost/functions/v1/wa-webhook";

Deno.test("webhook GET verification handshake", testOpts, async () => {
  const ok = await handler(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=mtb-local-verify-token&hub.challenge=42`));
  assertEquals(await ok.text(), "42");
  const bad = await handler(new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`));
  assertEquals(bad.status, 403);
  await bad.body?.cancel();
});

Deno.test("webhook rejects a bad signature", testOpts, async () => {
  const req = await signedRequest(URL_, inboundPayload({ from: randomWaId() }), "wrong-secret");
  const res = await handler(req);
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("inbound message creates contact + conversation, exactly once", testOpts, async () => {
  await ensureFunctionsServer();
  const from = randomWaId();
  const payload = inboundPayload({ from, name: "Puan Test", text: "Assalamualaikum, pakej Kundasang?", referral: { source_id: "120210000000001", headline: "Sabah Welcomes You" } });
  const r1 = await (await handler(await signedRequest(URL_, payload))).json();
  assertEquals(r1.inserted, 1);
  const r2 = await (await handler(await signedRequest(URL_, payload))).json();
  assertEquals(r2.duplicates, 1);
  const { contact, conv } = await conversationFor(from);
  assertEquals(contact.name, "Puan Test");
  assert(conv.last_inbound_at);
  assertEquals(conv.referral.source_id, "120210000000001");
  const { count } = await db().from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).eq("direction", "in");
  assertEquals(count, 1);
  const { data: labels } = await db().from("conversation_labels").select("label:labels(name)").eq("conversation_id", conv.id);
  assert((labels ?? []).some((l: any) => l.label.name === "FB ad"));
});

Deno.test("statuses move forward only; 131047 failure flags needs staff", testOpts, async () => {
  const from = randomWaId();
  await handler(await signedRequest(URL_, inboundPayload({ from, text: "hi" }))).then((r) => r.body?.cancel());
  const { conv } = await conversationFor(from);
  const sent = await gatewaySend({ conversation_id: conv.id, kind: "text", body: "Waalaikumussalam", sender_type: "system" }, { kind: "service" });
  assert(sent.ok);
  for (const st of ["read", "delivered"]) await handler(await signedRequest(URL_, statusPayload(sent.wa_message_id!, st))).then((r) => r.body?.cancel());
  const { data: m } = await db().from("messages").select("status, read_at").eq("id", sent.message_id).single();
  assertEquals(m!.status, "read");

  const sent2 = await gatewaySend({ conversation_id: conv.id, kind: "text", body: "Lagi satu", sender_type: "system" }, { kind: "service" });
  await handler(await signedRequest(URL_, statusPayload(sent2.wa_message_id!, "failed", 131047))).then((r) => r.body?.cancel());
  const { data: m2 } = await db().from("messages").select("status, error_code").eq("id", sent2.message_id).single();
  assertEquals(m2!.status, "failed");
  assertEquals(m2!.error_code, "131047");
  const { data: c2 } = await db().from("conversations").select("needs_staff, needs_staff_reason").eq("id", conv.id).single();
  assert(c2!.needs_staff);
});

Deno.test("STOP opts the customer out and confirms in Malay", testOpts, async () => {
  await ensureFunctionsServer();
  const from = randomWaId();
  await handler(await signedRequest(URL_, inboundPayload({ from, text: "STOP" }))).then((r) => r.body?.cancel());
  const { contact, conv } = await conversationFor(from);
  assert(contact.opted_out_at);
  const { data: out } = await db().from("messages").select("body, sender_type").eq("conversation_id", conv.id).eq("direction", "out").neq("type", "event");
  assert((out ?? []).some((m) => m.body?.includes("tidak akan hantar mesej promosi")));
});

Deno.test("'Hantar itinerary' on the final-itinerary template sends the PDF", testOpts, async () => {
  await ensureFunctionsServer();
  const from = randomWaId();
  await handler(await signedRequest(URL_, inboundPayload({ from, text: "Pakej Kundasang" }))).then((r) => r.body?.cancel());
  const { conv } = await conversationFor(from);
  const { data: agent } = await db().from("agents").select("id").eq("company_id", conv.company_id).eq("name", "Nura").single();
  await db().from("conversations").update({ agent_id: agent!.id }).eq("id", conv.id);
  const path = `${conv.company_id}/itineraries/test-${crypto.randomUUID()}.pdf`;
  await db().storage.from("media").upload(path, new TextEncoder().encode("%PDF-1.4 mock"), { contentType: "application/pdf" });
  const { data: it } = await db().from("itineraries").insert({ company_id: conv.company_id, agent_id: agent!.id, travelboost_product_id: "tb-kk-kundasang", file_path: path, file_name: "kk-akhir.pdf", status: "active" }).select("id").single();
  try {
    // As if the after-sales job sent the template (drafts can't be sent before Meta approves them).
    const { error } = await db().from("messages").insert({ company_id: conv.company_id, conversation_id: conv.id, direction: "out", sender_type: "system",
      type: "template", template_name: "itinerary_akhir_v1", body: "Itinerary akhir untuk trip KK Kundasang sudah siap.", status: "sent" });
    assert(!error, error?.message);
    const payload = inboundPayload({ from });
    Object.assign(payload.entry[0].changes[0].value.messages[0], { type: "button", button: { text: "Hantar itinerary", payload: "Hantar itinerary" } });
    delete (payload.entry[0].changes[0].value.messages[0] as Record<string, unknown>).text;
    await handler(await signedRequest(URL_, payload)).then((r) => r.body?.cancel());
    const { data: out } = await db().from("messages").select("type, media_filename").eq("conversation_id", conv.id).eq("direction", "out").eq("type", "document");
    assertEquals(out?.map((m) => m.media_filename), ["kk-akhir.pdf"]);
  } finally {
    await db().from("itineraries").delete().eq("id", it!.id);
  }
});
