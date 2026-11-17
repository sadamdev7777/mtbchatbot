import { assert, assertEquals, assertRejects } from "@std/assert";
import { db } from "../_shared/db.ts";
import { HttpError } from "../_shared/http.ts";
import { approveTemplate, COMPANY, conversationFor, inboundPayload, loginJwt, MEMBERS, randomWaId, signedRequest, testOpts } from "../_shared/testing.ts";
import { handler as webhook } from "../wa-webhook/handler.ts";
import { handler } from "./handler.ts";
import { gatewaySend } from "./send.ts";

async function newChat(text = "hi") {
  const from = randomWaId();
  await webhook(await signedRequest("http://x/wa-webhook", inboundPayload({ from, text }))).then((r) => r.body?.cancel());
  return conversationFor(from);
}

Deno.test("rule 2: free text is rejected outside the 24-hour window, before calling Meta", testOpts, async () => {
  const { conv } = await newChat();
  await db().from("conversations").update({ last_inbound_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq("id", conv.id);
  const before = (await db().from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;
  const err = await assertRejects(() => gatewaySend({ conversation_id: conv.id, kind: "text", body: "Salam", sender_type: "system" }, { kind: "service" }), HttpError);
  assertEquals(err.code, "window_closed");
  const after = (await db().from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id)).count;
  assertEquals(after, before);
});

Deno.test("templates must be approved; opted-out contacts get no marketing", testOpts, async () => {
  const { conv, contact } = await newChat();
  await db().from("templates").update({ status: "DRAFT" }).eq("company_id", COMPANY).eq("name", "susulan_pertanyaan_v1");
  const e1 = await assertRejects(() => gatewaySend({ conversation_id: conv.id, kind: "template", template: { name: "susulan_pertanyaan_v1", params: ["Puan", "Farah", "KK"] }, sender_type: "system" }, { kind: "service" }), HttpError);
  assertEquals(e1.code, "template_not_approved");
  await approveTemplate("susulan_pertanyaan_v1");
  await db().from("conversations").update({ last_inbound_at: new Date(Date.now() - 48 * 3600_000).toISOString() }).eq("id", conv.id);
  const ok = await gatewaySend({ conversation_id: conv.id, kind: "template", template: { name: "susulan_pertanyaan_v1", params: ["Puan", "Farah", "KK"] }, sender_type: "system" }, { kind: "service" });
  assert(ok.ok);
  const { data: m } = await db().from("messages").select("type, body").eq("id", ok.message_id).single();
  assertEquals(m!.type, "template");
  assert(m!.body!.includes("Puan, ini Farah"));
  await db().from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", contact.id);
  const e2 = await assertRejects(() => gatewaySend({ conversation_id: conv.id, kind: "template", template: { name: "susulan_pertanyaan_v1", params: ["a", "b", "c"] }, sender_type: "system" }, { kind: "service" }), HttpError);
  assertEquals(e2.code, "opted_out");
});

Deno.test("rule 3 + 10: staff send takes over with a name prefix; a second staff member is locked out", testOpts, async () => {
  const { conv } = await newChat("Nak tanya Kundasang");
  await db().from("conversations").update({ team_id: "30000000-0000-0000-0000-000000000001", agent_id: "50000000-0000-0000-0000-000000000001", holder_type: "ai", needs_staff: true, needs_staff_reason: "test" }).eq("id", conv.id);
  const farah = await loginJwt("farah@mtb.test");
  const res = await handler(new Request("http://x/wa-send", { method: "POST", headers: { authorization: `Bearer ${farah}` }, body: JSON.stringify({ conversation_id: conv.id, kind: "text", body: "Baik puan, saya semak.", sender_type: "staff" }) }));
  const j = await res.json();
  assert(j.ok, JSON.stringify(j));
  const { data: c } = await db().from("conversations").select("holder_type, holder_member_id, needs_staff").eq("id", conv.id).single();
  assertEquals(c!.holder_type, "staff");
  assertEquals(c!.holder_member_id, MEMBERS.farah);
  assertEquals(c!.needs_staff, false);
  const { data: m } = await db().from("messages").select("body").eq("id", j.message_id).single();
  assertEquals(m!.body, "*Farah*\nBaik puan, saya semak.");

  const aqil = await loginJwt("aqil@mtb.test");
  const res2 = await handler(new Request("http://x/wa-send", { method: "POST", headers: { authorization: `Bearer ${aqil}` }, body: JSON.stringify({ conversation_id: conv.id, kind: "text", body: "Hi", sender_type: "staff" }) }));
  assertEquals(res2.status, 409);
  await res2.body?.cancel();
});

Deno.test("AI messages carry the honest prefix", testOpts, async () => {
  const { conv } = await newChat();
  await db().from("conversations").update({ agent_id: "50000000-0000-0000-0000-000000000001", holder_type: "ai" }).eq("id", conv.id);
  const r = await gatewaySend({ conversation_id: conv.id, kind: "text", body: "Waalaikumussalam cik 😊", sender_type: "ai" }, { kind: "service" });
  const { data: m } = await db().from("messages").select("body, sender_type").eq("id", r.message_id).single();
  assertEquals(m!.body, "*Pembantu AI · Farah*\nWaalaikumussalam cik 😊");
});

Deno.test("rule 1: only wa-send/send.ts calls Meta's send methods", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of Deno.readDirSync(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith("_test.ts") && !p.includes("/providers/") && !p.endsWith("wa-send/send.ts")) {
        const src = Deno.readTextFileSync(p);
        if (/\.(sendText|sendTemplate|sendInteractiveButtons|sendMedia)\(/.test(src) || /graph\.facebook\.com[^"'`]*\/messages/.test(src)) offenders.push(p);
      }
    }
  };
  walk(new URL("..", import.meta.url).pathname.replace(/\/$/, ""));
  assertEquals(offenders, []);
});
