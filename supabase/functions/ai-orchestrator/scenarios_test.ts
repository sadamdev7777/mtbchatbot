import { assert, assertEquals } from "@std/assert";
import { runAllScenarios } from "../_shared/ai/scenarios.ts";
import { AGENTS, COMPANY, testOpts } from "../_shared/testing.ts";

Deno.test("all 10 seeded scenarios pass for Nura on the mock model", testOpts, async () => {
  const r = await runAllScenarios(COMPANY, AGENTS.nura, { knowledge: "live" });
  const failed = r.results.filter((x) => !x.passed).map((x) => `${x.name}: ${x.failures.join("; ")}`);
  assertEquals(failed, []);
  assertEquals(r.total, 10);
});

Deno.test("deterministic checks catch rule breaks", async () => {
  const { checkTurns } = await import("../_shared/ai/scenarios.ts");
  const turn = (text: string, extra: Record<string, unknown> = {}) => ({
    replies: [text], handover: null,
    what_bot_saw: { knowledge: "live", knowledge_versions: {}, official_answers: [], tools: [], rows_shown: 0, reply_ms: 1, labels: [], model: "m", cost_usd: 0, ...extra },
  }) as any;
  const s = { id: "x", key: "k", name: "n", customer_messages: [], rubric: "", checks: { banned_phrases: ["penuh"], expect_handover: true, ends_with_question: true } };
  const f = checkTurns(s, [turn("Maaf, tarikh itu penuh. Silakan pilih lain.")]);
  assert(f.some((x) => x.includes("penuh")));
  assert(f.some((x) => x.includes("silakan")));
  assert(f.some((x) => x.includes("hand over")));
  assert(f.some((x) => x.includes("question")));
  const nine = Array.from({ length: 9 }, (_, i) => `• 0${i + 1} Mac – 0${i + 4} Mac · RM1,399 · 10 seat`).join("\n");
  assert(checkTurns({ ...s, checks: {} }, [turn(nine)]).some((x) => x.includes("more than 8")));
  assert(checkTurns({ ...s, checks: {} }, [turn("Bulan Disember musim hujan cik?")]).some((x) => x.includes("weather")));
});
