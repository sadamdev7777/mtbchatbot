// Test bot sandbox (7.7): chat as a customer against the draft or live version of an agent.
// Nothing is sent to WhatsApp and nothing is written to TravelBoost (seat locks are faked).
import { db } from "../db.ts";
import type { TravelBoostProvider } from "../providers/travelboost.ts";
import { travelBoostFor } from "../providers/travelboost.ts";
import { activeKnowledge, type AgentRow, runAgentTurn, type TurnResult } from "./agent.ts";
import { modelFor } from "./model.ts";
import { modelName } from "./orchestrator.ts";
import type { KnowledgeDoc, TranscriptMessage } from "./prompt.ts";

export interface SandboxInput {
  agent_id: string;
  /** Previous turns plus the new customer message at the end. */
  messages: { role: "customer" | "bot"; text: string }[];
  knowledge?: "live" | "draft";
  stage?: string;
  /** Override knowledge (e.g. a proposed change from the night job). */
  knowledge_override?: { scope: "company" | "agent"; section: string; content: string }[];
}

export interface SandboxResult {
  replies: string[];
  handover: { reason: string; summary: string } | null;
  what_bot_saw: {
    knowledge: "live" | "draft"; knowledge_versions: Record<string, number>; official_answers: string[];
    tools: { name: string; input: unknown; summary: string; ms: number }[]; rows_shown: number; reply_ms: number;
    labels: { group: string; name: string; reason: string }[]; model: string; cost_usd: number;
  };
}

/** Read-only TravelBoost: searches are live, lock links are fake. */
function readOnly(tb: TravelBoostProvider): TravelBoostProvider {
  return {
    mode: tb.mode,
    searchProducts: (q) => tb.searchProducts(q),
    getProduct: (id) => tb.getProduct(id),
    findCustomer: (p) => tb.findCustomer(p),
    getBooking: (id) => tb.getBooking(id),
    getInvoice: (id) => tb.getInvoice(id),
    createLockLink: (i) => Promise.resolve({ url: `https://travelboost.test/lock/SANDBOX-${i.group_id}`, expires_at: new Date(Date.now() + 86400000).toISOString(), lock_id: "SANDBOX" }),
    recordPayment: () => Promise.reject(new Error("sandbox: payments are disabled")),
    updatePassengers: () => Promise.reject(new Error("sandbox: updates are disabled")),
  };
}

async function draftKnowledge(companyId: string, agentId: string): Promise<{ company: KnowledgeDoc[]; agent: KnowledgeDoc[] }> {
  const live = await activeKnowledge(companyId, agentId);
  const { data } = await db().from("knowledge_docs").select("scope, section, version, content, status").eq("company_id", companyId)
    .eq("status", "draft").or(`scope.eq.company,agent_id.eq.${agentId}`).order("version", { ascending: false });
  const pick = (scope: string, base: KnowledgeDoc[]) => {
    const out = new Map(base.map((d) => [d.section, d]));
    for (const d of (data ?? []).filter((x) => x.scope === scope)) {
      const cur = out.get(d.section);
      if (!cur || d.version > cur.version) out.set(d.section, { section: d.section, version: d.version, content: d.content });
    }
    return [...out.values()];
  };
  return { company: pick("company", live.company), agent: pick("agent", live.agent) };
}

export async function sandboxTurn(companyId: string, input: SandboxInput): Promise<SandboxResult> {
  const { data: agent } = await db().from("agents").select("*").eq("id", input.agent_id).eq("company_id", companyId).single() as { data: AgentRow | null };
  if (!agent) throw new Error("agent_not_found");
  const model = await modelFor(companyId);
  if (!model) throw new Error("Claude is not connected: the test bot needs the Claude API (or MOCK_PROVIDERS in development).");
  const { data: company } = await db().from("companies").select("settings").eq("id", companyId).single();
  const kind = input.knowledge ?? "live";
  let knowledge = kind === "draft" ? await draftKnowledge(companyId, agent.id) : await activeKnowledge(companyId, agent.id);
  for (const o of input.knowledge_override ?? []) {
    const list = o.scope === "company" ? knowledge.company : knowledge.agent;
    const next = list.filter((d) => d.section !== o.section).concat({ section: o.section, version: 0, content: o.content });
    knowledge = o.scope === "company" ? { ...knowledge, company: next } : { ...knowledge, agent: next };
  }
  const now = Date.now();
  const transcript: TranscriptMessage[] = input.messages.map((m, i) => ({
    direction: m.role === "customer" ? "in" : "out", sender_type: m.role === "customer" ? "customer" : "ai", body: m.text, type: "text",
    created_at: new Date(now - (input.messages.length - i) * 1000).toISOString(),
  }));
  const started = Date.now();
  const turn: TurnResult = await runAgentTurn({
    model, modelName: modelName(company?.settings ?? {}, "chat", agent.model_chat), tb: readOnly(await travelBoostFor(companyId)), agent,
    conversation: { id: "00000000-0000-0000-0000-000000000000", company_id: companyId, stage: input.stage ?? "lead", booking_ref: null, trip_date: null, ai_summary: null, key_details: {} },
    contact: { wa_id: "60100000000", name: "Pelanggan Ujian" }, transcript, labels: [], staffName: "Staf MTB", knowledge,
  });
  return {
    replies: turn.replies,
    handover: turn.effects.handover ?? null,
    what_bot_saw: {
      knowledge: kind, knowledge_versions: turn.knowledgeVersions, official_answers: turn.officialAnswersShown, tools: turn.effects.toolCalls,
      rows_shown: (turn.effects.seatData?.rows as unknown[] | undefined)?.length ?? 0, reply_ms: Date.now() - started,
      labels: turn.effects.labels, model: turn.model, cost_usd: turn.costUsd,
    },
  };
}
