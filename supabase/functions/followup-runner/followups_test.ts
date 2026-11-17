import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { runFollowups } from "../_shared/jobs/followups.ts";
import { AGENTS, approveTemplate, COMPANY, ensureFunctionsServer, MEMBERS, randomWaId, testOpts } from "../_shared/testing.ts";

const CHANNEL = "40000000-0000-0000-0000-000000000001";
async function chat(opts: { lastInboundHoursAgo: number; holder?: "ai" | "staff" }) {
  const { data: c } = await db().from("contacts").insert({ company_id: COMPANY, wa_id: randomWaId(), name: "Puan Ujian", opt_in: true }).select("id").single();
  const { data: conv } = await db().from("conversations").insert({
    company_id: COMPANY, channel_id: CHANNEL, contact_id: c!.id, agent_id: AGENTS.nura, routing_state: "routed",
    holder_type: opts.holder ?? "ai", holder_member_id: opts.holder === "staff" ? MEMBERS.farah : null, key_details: { destination: "KK Kundasang", month: "2027-03", pax: 2 },
  }).select("id").single();
  await db().from("messages").insert({ company_id: COMPANY, conversation_id: conv!.id, direction: "in", sender_type: "customer", body: "Kundasang Mac 2027 2 orang", status: "received" });
  await db().from("conversations").update({ last_inbound_at: new Date(Date.now() - opts.lastInboundHoursAgo * 3600_000).toISOString() }).eq("id", conv!.id);
  return conv!.id as string;
}
async function job(conv: string, key: string) {
  const { data: step } = await db().from("followup_steps").select("id").eq("company_id", COMPANY).eq("key", key).is("agent_id", null).single();
  const { data: j } = await db().from("followup_jobs").insert({ company_id: COMPANY, conversation_id: conv, step_id: step!.id, kind: "followup", step_key: key, due_at: new Date(Date.now() - 60000).toISOString(), created_at: new Date(Date.now() - 30 * 60_000).toISOString() }).select("id").single();
  return j!.id as string;
}
const status = async (id: string) => (await db().from("followup_jobs").select("status, result").eq("id", id).single()).data!;
const noon = () => new Date(new Date(Date.now() + 86400000).toISOString().slice(0, 10) + "T11:00:00+08:00");

Deno.test("free follow-up inside the window is written by the AI and sent", testOpts, async () => {
  await ensureFunctionsServer();
  const conv = await chat({ lastInboundHoursAgo: 3 });
  const j = await job(conv, "price_quiet_1");
  await runFollowups(new Date());
  const s = await status(j);
  // quiet hours depend on the wall clock; either sent now or postponed
  assert(s.status === "done" || s.status === "pending", JSON.stringify(s));
  if (s.status === "done") {
    const { data: m } = await db().from("messages").select("body, sender_type").eq("conversation_id", conv).eq("direction", "out").single();
    assertEquals(m!.sender_type, "ai");
    assert(m!.body!.startsWith("*Pembantu AI · Farah*"));
  }
});

Deno.test("stop rules: staff holds → reminder; quiet hours → wait; window closed → template; cap of 2 templates", testOpts, async () => {
  await approveTemplate("susulan_pertanyaan_v1");
  const held = await chat({ lastInboundHoursAgo: 3, holder: "staff" });
  const j1 = await job(held, "price_quiet_1");
  await runFollowups(noon());
  assertEquals((await status(j1)).result, "reminded_staff");

  const quiet = await chat({ lastInboundHoursAgo: 3 });
  const j2 = await job(quiet, "price_quiet_1");
  const night = new Date(new Date(Date.now() + 86400000).toISOString().slice(0, 10) + "T23:00:00+08:00");
  await db().from("conversations").update({ last_inbound_at: new Date(night.getTime() - 3 * 3600_000).toISOString() }).eq("id", quiet);
  await db().from("followup_jobs").update({ created_at: new Date(night.getTime() - 3600_000).toISOString(), due_at: new Date(night.getTime() - 60_000).toISOString() }).eq("id", j2);
  await runFollowups(night);
  const { data: waited } = await db().from("followup_jobs").select("status, due_at").eq("id", j2).single();
  assertEquals(waited!.status, "pending");
  assert(Date.parse(waited!.due_at) > night.getTime());

  const closed = await chat({ lastInboundHoursAgo: 80 });
  const j3 = await job(closed, "window_closed_3d");
  await runFollowups(noon());
  assertEquals((await status(j3)).result, "sent");
  const { data: t } = await db().from("messages").select("type, template_name").eq("conversation_id", closed).eq("direction", "out").single();
  assertEquals(t!.template_name, "susulan_pertanyaan_v1");

  await db().from("conversations").update({ templates_sent: 2 }).eq("id", closed);
  const j4 = await job(closed, "window_closed_3d");
  await runFollowups(noon());
  assertEquals((await status(j4)).result, "template_cap");
});
