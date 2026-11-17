import { assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { COMPANY, MEMBERS, testOpts } from "../_shared/testing.ts";
import { pushNotification } from "./handler.ts";

Deno.test("push respects per-event prefs and personal quiet hours", testOpts, async () => {
  await db().from("push_subscriptions").upsert({ company_id: COMPANY, member_id: MEMBERS.hakim, endpoint: "https://push.example/hakim", p256dh: "x", auth: "y" }, { onConflict: "endpoint" });
  const mk = async (event: string) => (await db().from("notifications").insert({ company_id: COMPANY, member_id: MEMBERS.hakim, event, title: "t" }).select("id").single()).data!.id;

  await db().from("notification_prefs").upsert({ company_id: COMPANY, member_id: MEMBERS.hakim, event: "mentioned", push: false }, { onConflict: "member_id,event" });
  assertEquals((await pushNotification(await mk("mentioned"))).status, "pref_off");

  await db().from("members").update({ push_quiet_hours: { start: "23:00", end: "07:00" } }).eq("id", MEMBERS.hakim);
  assertEquals((await pushNotification(await mk("customer_replied"), new Date("2026-11-17T23:30:00+08:00"))).status, "personal_quiet_hours");
  assertEquals((await pushNotification(await mk("customer_replied"), new Date("2026-11-17T10:00:00+08:00"))).status, "mock");
  await db().from("members").update({ push_quiet_hours: null }).eq("id", MEMBERS.hakim);
});
