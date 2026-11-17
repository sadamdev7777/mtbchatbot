// Scenario runner (7.7): replays saved customer scenarios against an agent (live, draft or a
// proposed knowledge change) and grades them with deterministic checks plus a Claude judge.
import { findBannedWords, INDONESIAN_WORDS, MAX_ROWS, WEATHER_WORDS } from "../core/rules.ts";
import { db } from "../db.ts";
import { jsonOf, modelFor } from "./model.ts";
import { modelName } from "./orchestrator.ts";
import { sandboxTurn, type SandboxInput, type SandboxResult } from "./sandbox.ts";

export interface Scenario { id: string; key: string | null; name: string; customer_messages: string[]; rubric: string; checks: Record<string, any> }
export interface ScenarioResult { scenario_id: string; name: string; passed: boolean; failures: string[]; transcript: { role: string; text: string }[]; judge?: { pass: boolean; reason: string } }

export async function scenariosFor(companyId: string, agentId: string): Promise<Scenario[]> {
  const { data } = await db().from("test_scenarios").select("id, key, name, customer_messages, rubric, checks")
    .eq("company_id", companyId).eq("enabled", true).or(`agent_id.is.null,agent_id.eq.${agentId}`).order("created_at");
  return (data ?? []) as Scenario[];
}

/** Deterministic checks; returns the failures. */
export function checkTurns(s: Scenario, turns: SandboxResult[]): string[] {
  const c = s.checks ?? {};
  const allReplies = turns.flatMap((t) => t.replies);
  const text = allReplies.join("\n");
  const f: string[] = [];
  const rowsPerTurn = turns.map((t) => Math.max(t.what_bot_saw.rows_shown, t.replies.join("\n").split("\n").filter((l) => /^\s*[•\-\d]+[.)]?\s.*RM\s?\d/.test(l)).length));
  if (rowsPerTurn.some((n) => n > (c.max_rows ?? MAX_ROWS))) f.push(`Listed more than ${c.max_rows ?? MAX_ROWS} dates`);
  if (c.single_month) {
    for (const t of turns) {
      const months = new Set(t.what_bot_saw.tools.filter((x) => x.name === "search_products").map((x) => (x.input as any)?.month));
      if (months.size > 1) f.push("Searched more than one month in one reply");
    }
  }
  for (const p of c.banned_phrases ?? []) if (text.toLowerCase().includes(String(p).toLowerCase())) f.push(`Used banned phrase "${p}"`);
  const banned = findBannedWords(text, c.banned_words ?? INDONESIAN_WORDS);
  if (banned.length) f.push(`Used banned words: ${banned.join(", ")}`);
  const weather = findBannedWords(text, WEATHER_WORDS);
  if (weather.length) f.push(`Mentioned weather: ${weather.join(", ")}`);
  if (c.expect_handover && !turns.some((t) => t.handover)) f.push("Did not hand over to staff");
  if (c.expect_no_handover && turns.some((t) => t.handover)) f.push("Handed over when it should not");
  if (c.ends_with_question && !/\?\s*$/.test(allReplies.at(-1) ?? "")) f.push("Last message does not end with a question");
  if (c.must_include_any && !(c.must_include_any as string[]).some((w) => text.toLowerCase().includes(w.toLowerCase()))) f.push(`Missing any of: ${(c.must_include_any as string[]).join(", ")}`);
  if (c.expect_decline && turns.some((t) => t.what_bot_saw.tools.some((x) => x.name === "search_products"))) f.push("Did not decline the unrelated topic");
  if (allReplies.some((r) => r.length > 1200)) f.push("A message is too long for WhatsApp style");
  return f;
}

async function judge(companyId: string, s: Scenario, transcript: { role: string; text: string }[]): Promise<{ pass: boolean; reason: string; costUsd: number }> {
  const model = await modelFor(companyId);
  if (!model) return { pass: true, reason: "no judge available", costUsd: 0 };
  const { data: co } = await db().from("companies").select("settings").eq("id", companyId).single();
  const res = await model.call({
    purpose: "judge", model: modelName(co?.settings ?? {}, "judge"), maxTokens: 600, effort: "low",
    system: [{ type: "text", text: "You grade a WhatsApp travel-sales bot transcript against a rubric. Be strict but fair. The bot must reply in Malaysian Malay. Answer JSON only." }],
    messages: [{ role: "user", content: `RUBRIC: ${s.rubric}\n\nTRANSCRIPT:\n${transcript.map((t) => `${t.role === "customer" ? "CUSTOMER" : "BOT REPLY"}: ${t.text}`).join("\n")}\n\nReturn {"pass": true|false, "reason": "<one sentence>"}.` }],
    jsonSchema: { type: "object", additionalProperties: false, required: ["pass", "reason"], properties: { pass: { type: "boolean" }, reason: { type: "string" } } },
  });
  const j = jsonOf<{ pass: boolean; reason: string }>(res.content) ?? { pass: false, reason: "Judge returned no verdict" };
  return { ...j, costUsd: res.costUsd };
}

export async function runScenario(companyId: string, agentId: string, s: Scenario, base: Omit<SandboxInput, "agent_id" | "messages">): Promise<ScenarioResult> {
  const transcript: { role: "customer" | "bot"; text: string }[] = [];
  const turns: SandboxResult[] = [];
  for (const msg of s.customer_messages) {
    transcript.push({ role: "customer", text: msg });
    const r = await sandboxTurn(companyId, { ...base, agent_id: agentId, messages: [...transcript] });
    turns.push(r);
    for (const rep of r.replies) transcript.push({ role: "bot", text: rep });
    if (r.handover) break;
  }
  const failures = checkTurns(s, turns);
  const j = await judge(companyId, s, transcript);
  if (!j.pass) failures.push(`Judge: ${j.reason}`);
  return { scenario_id: s.id, name: s.name, passed: failures.length === 0, failures, transcript, judge: { pass: j.pass, reason: j.reason } };
}

/** Runs every scenario for an agent; stores test_runs under one batch id. */
export async function runAllScenarios(companyId: string, agentId: string, opts: Omit<SandboxInput, "agent_id" | "messages"> & { context?: string; scenarioIds?: string[] } = {}) {
  const batch = crypto.randomUUID();
  let scenarios = await scenariosFor(companyId, agentId);
  if (opts.scenarioIds?.length) scenarios = scenarios.filter((s) => opts.scenarioIds!.includes(s.id));
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    let r: ScenarioResult;
    try {
      r = await runScenario(companyId, agentId, s, { knowledge: opts.knowledge, knowledge_override: opts.knowledge_override, stage: opts.stage });
    } catch (e) {
      r = { scenario_id: s.id, name: s.name, passed: false, failures: [`Error: ${(e as Error).message}`], transcript: [] };
    }
    results.push(r);
    await db().from("test_runs").insert({
      company_id: companyId, batch_id: batch, agent_id: agentId, scenario_id: s.id, context: opts.context ?? "manual", passed: r.passed,
      transcript: r.transcript, details: { failures: r.failures, judge: r.judge },
    });
  }
  return { batch_id: batch, total: results.length, passed: results.filter((r) => r.passed).length, results };
}
