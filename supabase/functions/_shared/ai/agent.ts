// One agent turn: load context, build the prompt, run the tool loop. No side effects outside the
// returned Effects (the orchestrator decides whether to send, draft or discard).
import { stageMode } from "../core/rules.ts";
import { db } from "../db.ts";
import type { TravelBoostProvider } from "../providers/travelboost.ts";
import { type ChatModel, type ContentBlock, type MessageParam, textOf, type ToolUseBlock, type Usage } from "./model.ts";
import { buildPrompt, splitReplies, type KnowledgeDoc, type StageMode, type TranscriptMessage } from "./prompt.ts";
import { type Effects, executeTool, newEffects, TOOL_DEFS } from "./tools.ts";

export interface AgentRow {
  id: string; company_id: string; name: string; persona: string; team_id: string | null; mode: string; status: string;
  travelboost_product_ids: string[]; destination_keywords: string[]; description: string | null; default_staff_member_id: string | null;
  model_chat: string | null; close_sale_instructions: string; aftersales_instructions: string; destination: string | null;
}

export interface TurnInput {
  model: ChatModel;
  modelName: string;
  tb: TravelBoostProvider;
  agent: AgentRow;
  conversation: { id: string; company_id: string; stage: string; booking_ref: string | null; trip_date: string | null; ai_summary: string | null; key_details: Record<string, unknown> };
  contact: { wa_id: string; name: string | null };
  transcript: TranscriptMessage[];
  labels: string[];
  staffName: string;
  /** Knowledge override for the test bot (draft versions). */
  knowledge?: { company: KnowledgeDoc[]; agent: KnowledgeDoc[] };
  extraUserInstruction?: string;
  maxToolRounds?: number;
}

export interface TurnResult {
  replies: string[];
  effects: Effects;
  usage: Usage;
  costUsd: number;
  model: string;
  stopReason: string | null;
  knowledgeVersions: Record<string, number>;
  officialAnswersShown: string[];
}

export function agentDestination(a: AgentRow): string {
  return a.destination || a.destination_keywords[0] || a.name;
}

export async function activeKnowledge(companyId: string, agentId: string): Promise<{ company: KnowledgeDoc[]; agent: KnowledgeDoc[] }> {
  const { data } = await db().from("knowledge_docs").select("scope, agent_id, section, version, content")
    .eq("company_id", companyId).eq("status", "active").or(`scope.eq.company,agent_id.eq.${agentId}`).order("section");
  const rows = (data ?? []) as (KnowledgeDoc & { scope: string })[];
  return { company: rows.filter((r) => r.scope === "company"), agent: rows.filter((r) => r.scope === "agent") };
}

export async function itinerarySummary(companyId: string, agentId: string): Promise<string | null> {
  const { data } = await db().from("itineraries").select("travelboost_product_id, applies_to, extracted").eq("company_id", companyId)
    .eq("agent_id", agentId).eq("status", "active").order("created_at", { ascending: false }).limit(3);
  if (!data?.length) return null;
  return data.map((it) => {
    const ex = it.extracted ?? {};
    const days = (ex.days ?? []) as { day: number; route?: string; activities?: string[]; meals?: string[]; hotel?: string }[];
    return `Product ${it.travelboost_product_id} (${it.applies_to === "all" ? "all dates" : `dates ${JSON.stringify(it.applies_to)}`}):\n` +
      days.map((d) => `Day ${d.day}: ${d.route ?? ""} — ${(d.activities ?? []).join(", ")}${d.meals?.length ? ` · meals: ${d.meals.join(", ")}` : ""}${d.hotel ? ` · hotel: ${d.hotel}` : ""}`).join("\n") +
      (ex.included?.length ? `\nIncluded: ${ex.included.join(", ")}` : "") + (ex.not_included?.length ? `\nNot included: ${ex.not_included.join(", ")}` : "") +
      (ex.free_and_easy?.length ? `\nFree & easy: ${ex.free_and_easy.join(", ")}` : "");
  }).join("\n\n");
}

export async function runAgentTurn(i: TurnInput): Promise<TurnResult> {
  const mode: StageMode = stageMode(i.conversation.stage) as StageMode;
  const knowledge = i.knowledge ?? await activeKnowledge(i.conversation.company_id, i.agent.id);
  const lastCustomer = [...i.transcript].reverse().filter((m) => m.direction === "in").slice(0, 3).map((m) => m.body ?? "").join(" ");
  const { data: oa } = await db().rpc("top_official_answers", { p_company: i.conversation.company_id, p_agent: i.agent.id, p_question: lastCustomer || "-", p_limit: 5 });
  const official = (oa ?? []) as { id: string; question: string; answer: string }[];
  const prompt = buildPrompt({
    agent: {
      id: i.agent.id, name: i.agent.name, persona: i.agent.persona, destination: agentDestination(i.agent), product_ids: i.agent.travelboost_product_ids,
      close_sale_instructions: i.agent.close_sale_instructions, aftersales_instructions: i.agent.aftersales_instructions,
    },
    mode,
    companyDocs: knowledge.company,
    agentDocs: knowledge.agent,
    itinerarySummary: await itinerarySummary(i.conversation.company_id, i.agent.id),
    officialAnswers: official,
    context: {
      now: new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "full", timeStyle: "short" }),
      customerName: i.contact.name, customerPhone: i.contact.wa_id, stage: i.conversation.stage, labels: i.labels,
      booking: i.conversation.booking_ref, previousSummary: i.conversation.ai_summary, staffName: i.staffName,
      tripDate: i.conversation.trip_date, keyDetails: i.conversation.key_details ?? {},
    },
    transcript: i.transcript,
    extraUserInstruction: i.extraUserInstruction,
  });

  const effects = newEffects();
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0, model = i.modelName, stopReason: string | null = null, finalText = "";
  const messages: MessageParam[] = [...prompt.messages];
  const ctx = {
    companyId: i.conversation.company_id, conversation: i.conversation, contact: i.contact, tb: i.tb, effects,
    agent: { id: i.agent.id, name: i.agent.name, travelboost_product_ids: i.agent.travelboost_product_ids, destination: agentDestination(i.agent) },
  };

  for (let round = 0; round < (i.maxToolRounds ?? 6); round++) {
    const res = await i.model.call({ purpose: "agent", model: i.modelName, system: prompt.system, messages, tools: TOOL_DEFS, maxTokens: 8000, effort: "low" });
    for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += res.usage[k];
    cost += res.costUsd;
    model = res.model;
    stopReason = res.stopReason;
    if (res.stopReason === "refusal") {
      effects.handover = { reason: "The AI model declined to answer this message", summary: "Model refusal; staff should read the chat." };
      finalText = "Baik cik, saya minta staf kami sambung dalam chat ini. Staf akan balas secepat mungkin.";
      break;
    }
    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (!uses.length || res.stopReason !== "tool_use") {
      finalText = textOf(res.content);
      break;
    }
    messages.push({ role: "assistant", content: res.content } as unknown as MessageParam);
    const results = [];
    for (const u of uses) {
      let out: unknown;
      try {
        out = await executeTool(u.name, u.input, ctx);
      } catch (e) {
        out = { error: (e as Error).message };
      }
      results.push({ type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  const versions: Record<string, number> = {};
  for (const d of [...knowledge.company, ...knowledge.agent]) versions[d.section] = d.version;
  if (effects.officialAnswerId) await db().rpc("bump_official_answer", { p_id: effects.officialAnswerId });
  return {
    replies: splitReplies(finalText), effects, usage, costUsd: cost, model, stopReason, knowledgeVersions: versions,
    officialAnswersShown: official.map((o) => o.question),
  };
}

export type { ContentBlock };
