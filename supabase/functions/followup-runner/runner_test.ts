import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { runBroadcasts } from "../_shared/jobs/broadcasts.ts";
import { runAutoClose, runStaffReminders } from "../_shared/jobs/automation.ts";
import { approveTemplate, COMPANY, ensureFunctionsServer, MEMBERS, randomWaId, testOpts } from "../_shared/testing.ts";

const CHANNEL = "40000000-0000-0000-0000-000000000001";

async function contact(optIn: boolean, optedOut = false) {
  const { data } = await db().from("contacts").insert({ company_id: COMPANY, wa_id: randomWaId(), name: "BC Test", opt_in: optIn, opted_out_at: optedOut ? new Date().toISOString() : null }).select("id").single();
  return data!.id as string;
}

Deno.test("broadcast: opted-in only, waits in quiet hours, sends in batches", testOpts, async () => {
  await ensureFunctionsServer();
  await approveTemplate("susulan_pertanyaan_v1");
  const ok = await contact(true), noOpt = await contact(false), out = await contact(true, true);
  const { data: b } = await db().from("broadcasts").insert({
    company_id: COMPANY, name: "test", template_name: "susulan_pertanyaan_v1", status: "scheduled", scheduled_at: new Date(Date.now() - 1000).toISOString(),
    segment: { contact_ids: [ok, noOpt, out] }, variable_mapping: { "1": { source: "contact.name" }, "2": { source: "static", value: "Farah" }, "3": { source: "static", value: "KK" } },
  }).select("id").single();

  // Tomorrow (Malaysia time) so the broadcast is already due. 23:00 is quiet: nothing happens.
  const day = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  await runBroadcasts(new Date(`${day}T23:00:00+08:00`));
  const { data: still } = await db().from("broadcasts").select("status").eq("id", b!.id).single();
  assertEquals(still!.status, "scheduled");

  await runBroadcasts(new Date(`${day}T10:00:00+08:00`));
  const { data: recs } = await db().from("broadcast_recipients").select("contact_id, status").eq("broadcast_id", b!.id);
  assertEquals(recs!.length, 1);
  assertEquals(recs![0].contact_id, ok);
  assertEquals(recs![0].status, "sent");
  await runBroadcasts(new Date(`${day}T10:01:00+08:00`));
  const { data: done } = await db().from("broadcasts").select("status").eq("id", b!.id).single();
  assertEquals(done!.status, "sent");
});

Deno.test("staff reminder after 30 minutes in office hours; auto-close old chats", testOpts, async () => {
  const c = await contact(true);
  const now = new Date("2026-11-17T11:00:00+08:00");
  const { data: conv } = await db().from("conversations").insert({
    company_id: COMPANY, channel_id: CHANNEL, contact_id: c, holder_type: "staff", holder_member_id: MEMBERS.farah,
  }).select("id").single();
  await db().from("conversations").update({ last_inbound_at: new Date(now.getTime() - 40 * 60000).toISOString() }).eq("id", conv!.id);
  await runStaffReminders(now);
  const { data: n } = await db().from("notifications").select("title").eq("member_id", MEMBERS.farah).eq("event", "team_unanswered").order("created_at", { ascending: false }).limit(1);
  assert(n?.[0]?.title.includes("waiting for your reply"));
  // once only
  const before = (await db().from("notifications").select("id", { count: "exact", head: true }).eq("member_id", MEMBERS.farah)).count;
  await runStaffReminders(now);
  const after = (await db().from("notifications").select("id", { count: "exact", head: true }).eq("member_id", MEMBERS.farah)).count;
  assertEquals(after, before);

  await db().from("automation_rules").update({ enabled: true }).eq("company_id", COMPANY).eq("key", "auto_close");
  await db().from("conversations").update({ last_message_at: new Date(Date.now() - 8 * 86400000).toISOString(), needs_staff: false }).eq("id", conv!.id);
  await runAutoClose(new Date());
  const { data: closed } = await db().from("conversations").select("status").eq("id", conv!.id).single();
  assertEquals(closed!.status, "closed");
  await db().from("automation_rules").update({ enabled: false }).eq("company_id", COMPANY).eq("key", "auto_close");
});
