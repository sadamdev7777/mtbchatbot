import { assert, assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { AGENTS, COMPANY, MEMBERS, testOpts } from "../_shared/testing.ts";
import { runAllScenarios } from "../_shared/ai/scenarios.ts";
import { handler } from "./handler.ts";

const call = (body: Record<string, unknown>) =>
  handler(new Request("http://x/itinerary-extract", { method: "POST", headers: { authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` }, body: JSON.stringify({ company_id: COMPANY, ...body }) })).then((r) => r.json());

Deno.test("itinerary: extract → questions block activation → answer → activate creates a knowledge version", testOpts, async () => {
  const path = `${COMPANY}/itineraries/test-${crypto.randomUUID()}.pdf`;
  await db().storage.from("media").upload(path, new TextEncoder().encode("%PDF-1.4 mock"), { contentType: "application/pdf" });
  const { data: it } = await db().from("itineraries").insert({ company_id: COMPANY, agent_id: AGENTS.nura, travelboost_product_id: "tb-kk-kundasang", file_path: path, file_name: "kk-2027.pdf", uploaded_by: MEMBERS.owner }).select("id").single();
  const ex = await call({ action: "extract", itinerary_id: it!.id });
  assertEquals(ex.status, "needs_answers");
  const blocked = await call({ action: "activate", itinerary_id: it!.id });
  assertEquals(blocked.error, "questions_open");
  const { data: qs } = await db().from("itinerary_questions").select("id, options").eq("itinerary_id", it!.id);
  for (const q of qs ?? []) await db().from("itinerary_questions").update({ answer: q.options[0], answered_by: MEMBERS.owner }).eq("id", q.id);
  const done = await call({ action: "activate", itinerary_id: it!.id });
  assertEquals(done.activated, true, JSON.stringify(done));
  const { data: doc } = await db().from("knowledge_docs").select("status, content, source").eq("agent_id", AGENTS.nura).eq("section", "itinerary_tb-kk-kundasang").eq("status", "active").single();
  assertEquals(doc!.source, "itinerary");
  assert(doc!.content.includes("Clarifications confirmed by staff"));
  assert(!/RM\s?\d/.test(doc!.content), "no prices in knowledge");
});

Deno.test("wizard: 15 generated + 10 seed scenarios = 25, all pass on the mock model", testOpts, async () => {
  const r = await call({ action: "generate_scenarios", agent_id: AGENTS.sari });
  assertEquals(r.created, 15);
  const run = await runAllScenarios(COMPANY, AGENTS.sari, { context: "go_live" });
  assertEquals(run.total, 25);
  assertEquals(run.results.filter((x) => !x.passed).map((x) => `${x.name}: ${x.failures.join("; ")}`), []);
});
