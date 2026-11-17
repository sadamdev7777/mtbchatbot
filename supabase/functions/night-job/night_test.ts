import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { COMPANY, ensureFunctionsServer, testOpts } from "../_shared/testing.ts";
import { contextFor, phaseForHour, reportWindow, runPhase } from "./phases.ts";

Deno.test("phase schedule and report window (MYT)", () => {
  assertEquals(phaseForHour(0), "audit");
  assertEquals(phaseForHour(6), "report");
  assertEquals(phaseForHour(7), null);
  const w = reportWindow(new Date("2026-11-18T00:05:00+08:00"));
  assertEquals(w.date, "2026-11-17");
  assertEquals(w.from, new Date("2026-11-17T00:00:00+08:00").toISOString());
});

Deno.test("night job: audit finds price-without-ask, staff style applied directly, report written and sent", testOpts, async () => {
  await ensureFunctionsServer();
  await db().from("templates").update({ status: "APPROVED" }).eq("company_id", COMPANY).eq("name", "laporan_pagi_v1");
  const now = new Date(Date.now() + 86400000);
  const ctx = await contextFor(COMPANY, new Date(new Date(now).toISOString().slice(0, 10) + "T00:30:00+08:00"));
  // a bot chat and a staff chat inside the window
  const { data: conv } = await db().from("conversations").select("id").eq("id", "70000000-0000-0000-0000-000000000001").single();
  const inWindow = new Date(Date.parse(ctx.from) + 3600_000).toISOString();
  await db().from("messages").insert([
    { company_id: COMPANY, conversation_id: conv!.id, direction: "out", sender_type: "ai", type: "text", status: "sent", body: "*Pembantu AI · Farah*\nTarikh 12 Mac RM1,649 seorang.", created_at: inWindow },
    { company_id: COMPANY, conversation_id: "70000000-0000-0000-0000-000000000002", direction: "out", sender_type: "staff", type: "text", status: "sent", body: "*Aqil*\nBaik encik, saya semak dulu ya.", created_at: inWindow },
    { company_id: COMPANY, conversation_id: "70000000-0000-0000-0000-000000000002", direction: "out", sender_type: "staff", type: "text", status: "sent", body: "*Aqil*\nNanti saya hantar link ya", created_at: inWindow },
  ]);
  const a = await runPhase(ctx, "audit") as any;
  assert(a.ok);
  assert(a.counts.chats_audited >= 1);
  assert(a.counts.price_no_booking_ask >= 1);
  const s = await runPhase(ctx, "staff_style") as any;
  assertEquals(s.applied, true);
  const { data: style } = await db().from("knowledge_docs").select("source, content").eq("company_id", COMPANY).eq("section", "language_style").eq("status", "active").single();
  assertEquals(style!.source, "night_job");
  for (const p of ["deposit_compare", "proposals", "staff_audit", "test_changes", "report"] as const) assert((await runPhase(ctx, p) as any).ok, p);
  const { data: rep } = await db().from("night_reports").select("status, body, phases").eq("id", ctx.reportId).single();
  assertEquals(rep!.status, "sent");
  assert(rep!.body!.includes("bot chats audited"));
  assertEquals(Object.keys(rep!.phases).length, 7);
});
