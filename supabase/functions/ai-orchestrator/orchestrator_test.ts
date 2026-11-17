import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { db } from "../_shared/db.ts";
import { findBannedWords, INDONESIAN_WORDS } from "../_shared/core/rules.ts";
import { handleInbound, processConversation } from "../_shared/ai/orchestrator.ts";
import { AGENTS, COMPANY, conversationFor, ensureFunctionsServer, inboundPayload, MEMBERS, randomWaId, signedRequest, testOpts, TEAMS } from "../_shared/testing.ts";
import { handler as webhook } from "../wa-webhook/handler.ts";

async function say(from: string, text: string, extra: Record<string, unknown> = {}) {
  const payload = inboundPayload({ from, text, ...extra });
  await (await webhook(await signedRequest("http://x/wa-webhook", payload))).json();
  const { conv } = await conversationFor(from);
  const { data: m } = await db().from("messages").select("id").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).single();
  return { conv, messageId: m!.id as string };
}
async function outbound(convId: string) {
  const { data } = await db().from("messages").select("body, type, sender_type, interactive").eq("conversation_id", convId).eq("direction", "out").order("created_at");
  return data ?? [];
}

Deno.test({ name: "setup", ...testOpts, fn: async () => {
  await ensureFunctionsServer();
  await db().from("agents").update({ mode: "auto", status: "live" }).eq("id", AGENTS.nura);
}});

Deno.test("keyword routes to Nura; auto reply with honest prefix, ≤8 dates, tool line and follow-ups", testOpts, async () => {
  const from = randomWaId();
  const { conv, messageId } = await say(from, "Assalamualaikum, nak tanya pakej Kundasang bulan Mac 2027 untuk 2 orang");
  assertEquals(await handleInbound(conv.id, messageId, 0), "sent");
  const { data: c } = await db().from("conversations").select("agent_id, holder_type, key_details").eq("id", conv.id).single();
  assertEquals(c!.agent_id, AGENTS.nura);
  assertEquals(c!.holder_type, "ai");
  assertEquals(c!.key_details.month, "2027-03");
  const out = await outbound(conv.id);
  const replies = out.filter((m) => m.sender_type === "ai" && m.type === "text");
  assert(replies.length >= 1 && replies.length <= 4);
  assert(replies.every((m) => m.body!.startsWith("*Pembantu AI · Farah*")));
  const dates = replies.map((m) => m.body).join("\n").split("\n").filter((l) => l.startsWith("•"));
  assert(dates.length >= 1 && dates.length <= 8);
  assert(out.some((m) => m.type === "tool" && m.body!.startsWith("Tool: search_products · KK Kundasang · Mac 2027")));
  assertEquals(findBannedWords(replies.map((m) => m.body).join(" "), INDONESIAN_WORDS), []);
  const { data: jobs } = await db().from("followup_jobs").select("step_key").eq("conversation_id", conv.id).eq("status", "pending");
  assert((jobs ?? []).some((j) => j.step_key === "price_quiet_1"));
  assert((jobs ?? []).some((j) => j.step_key === "window_closed_3d"));
});

Deno.test("debounce: split messages become one turn", testOpts, async () => {
  const from = randomWaId();
  const first = await say(from, "Assalamualaikum, nak tanya Kundasang");
  const second = await say(from, "pakej Mac 2027, 3 orang");
  assertEquals(await handleInbound(first.conv.id, first.messageId, 0), "superseded");
  assertEquals(await handleInbound(second.conv.id, second.messageId, 0), "sent");
});

Deno.test("handover: flight question → Needs staff, polite Malay reply, AI summary note, team round-robin", testOpts, async () => {
  await db().from("members").update({ last_seen_at: new Date().toISOString(), on_leave_until: null }).eq("id", MEMBERS.farah);
  const from = randomWaId();
  const { conv, messageId } = await say(from, "Kundasang Mac 2027 4 orang. Boleh book flight dari Alor Setar ke KLIA sekali?");
  assertEquals(await handleInbound(conv.id, messageId, 0), "handover");
  const { data: c } = await db().from("conversations").select("needs_staff, needs_staff_reason, team_id, holder_type, ai_summary").eq("id", conv.id).single();
  assert(c!.needs_staff);
  assertStringIncludes(c!.needs_staff_reason!, "flight");
  assertEquals(c!.team_id, TEAMS.sabah);
  assert(c!.ai_summary);
  const out = await outbound(conv.id);
  assert(out.some((m) => m.sender_type === "ai" && m.body!.includes("staf kami sambung")));
  assert(out.some((m) => m.type === "note" && m.body!.startsWith("AI summary:")));
});

Deno.test("honest identity and business-only scope", testOpts, async () => {
  const from = randomWaId();
  const a = await say(from, "Kundasang? ni bot ke?");
  await handleInbound(a.conv.id, a.messageId, 0);
  const b = await say(from, "Boleh tolong buat kerja sekolah matematik anak saya?");
  await handleInbound(b.conv.id, b.messageId, 0);
  const texts = (await outbound(a.conv.id)).filter((m) => m.sender_type === "ai" && m.type === "text").map((m) => m.body!);
  assert(texts.some((t) => t.includes("pembantu AI")));
  assert(texts.some((t) => t.includes("hanya boleh bantu tentang pakej")));
});

Deno.test("staff holds the chat → AI writes a draft, sends nothing", testOpts, async () => {
  const from = randomWaId();
  const { conv } = await say(from, "Kundasang Mac 2027 untuk 2 orang");
  await db().from("conversations").update({ agent_id: AGENTS.nura, routing_state: "routed", holder_type: "staff", holder_member_id: MEMBERS.farah }).eq("id", conv.id);
  const r = await processConversation(conv.id);
  assertEquals(r.decision, "draft");
  const { data: drafts } = await db().from("ai_drafts").select("body, status, seat_data").eq("conversation_id", conv.id);
  assertEquals(drafts!.length, 1);
  assert(drafts![0].seat_data?.summary);
  assertEquals((await outbound(conv.id)).filter((m) => m.sender_type === "ai").length, 0);
});

Deno.test("unclear first message → buttons; answer routes to the team", testOpts, async () => {
  const from = randomWaId();
  const a = await say(from, "Hi, saya nak tanya pakej");
  assertEquals(await handleInbound(a.conv.id, a.messageId, 0), "asked");
  const out = await outbound(a.conv.id);
  assertEquals(out.at(-1)!.type, "interactive");
  assertEquals(out.at(-1)!.interactive.buttons.length, 3);
  const b = await say(from, "", { button: { id: "dest_overseas", title: "Luar negara" } });
  assertEquals(await handleInbound(b.conv.id, b.messageId, 0), "routed_team");
  const { data: c } = await db().from("conversations").select("team_id").eq("id", a.conv.id).single();
  assertEquals(c!.team_id, TEAMS.overseas);
});

Deno.test("spend cap reached → no AI at all (drafts off too)", testOpts, async () => {
  const from = randomWaId();
  const { conv } = await say(from, "Kundasang Mac 2027, 2 orang");
  const month = new Date().toISOString().slice(0, 7) + "-01";
  await db().from("spend").upsert({ company_id: COMPANY, month, provider: "claude", amount: 999999 }, { onConflict: "company_id,month,provider" });
  const r = await processConversation(conv.id);
  assertEquals(r.reason, "spend_cap_reached");
  await db().from("spend").delete().eq("company_id", COMPANY).eq("provider", "claude");
});
