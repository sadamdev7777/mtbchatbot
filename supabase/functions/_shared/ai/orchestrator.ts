// AI orchestration: debounce → route → decide mode → run agent → re-check → send / draft / discard.
import { effectiveMode, routeFirstMessage, type RoutingRule } from "../core/rules.ts";
import { isWithinOfficeHours, type OfficeHours } from "../core/time.ts";
import { db } from "../db.ts";
import { sendViaGateway } from "../functions.ts";
import { travelBoostFor } from "../providers/travelboost.ts";
import { type AgentRow, runAgentTurn, type TurnResult } from "./agent.ts";
import { scheduleCloseSaleFollowups } from "./lifecycle.ts";
import { type ChatModel, jsonOf, modelFor, textOf } from "./model.ts";
import type { TranscriptMessage } from "./prompt.ts";

export const DEFAULT_MODELS = { router: "claude-haiku-5-5", chat: "claude-sonnet-5-5", night: "claude-opus-5-5", judge: "claude-haiku-5-5" };

export function debounceMs(settings: Record<string, any>): number {
  const o = Deno.env.get("DEBOUNCE_SECONDS_OVERRIDE");
  return 1000 * (o ? Number(o) : Number(settings?.debounce_seconds ?? 8));
}

export function modelName(settings: Record<string, any>, kind: keyof typeof DEFAULT_MODELS, agentOverride?: string | null): string {
  return agentOverride || settings?.models?.[kind] || DEFAULT_MODELS[kind];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Called by wa-webhook for every inbound message. Waits for the debounce, then runs once for the burst. */
export async function handleInbound(conversationId: string, messageId: string, waitMs?: number): Promise<string> {
  const { data: conv } = await db().from("conversations").select("company:companies(settings)").eq("id", conversationId).single();
  await sleep(waitMs ?? debounceMs((conv?.company as any)?.settings ?? {}));
  const { data: latest } = await db().from("messages").select("id").eq("conversation_id", conversationId).eq("direction", "in")
    .order("created_at", { ascending: false }).limit(1).single();
  if (latest?.id !== messageId) return "superseded"; // a newer message restarted the debounce
  return (await processConversation(conversationId, { claim: true })).decision;
}

/** Runs chats whose debounce passed but were never processed (lost background tasks). */
export async function sweep(): Promise<number> {
  const { data } = await db().from("conversations").select("id, company:companies(settings)").not("ai_pending_since", "is", null)
    .lt("ai_pending_since", new Date(Date.now() - 45_000).toISOString()).limit(50);
  for (const c of data ?? []) await processConversation(c.id, { claim: true }).catch((e) => console.error("sweep", c.id, e));
  return data?.length ?? 0;
}

async function logRun(companyId: string, conversationId: string | null, agentId: string | null, purpose: string, t: { model: string; usage: TurnResult["usage"]; costUsd: number }, extra: Record<string, unknown>) {
  const { data } = await db().from("ai_runs").insert({
    company_id: companyId, conversation_id: conversationId, agent_id: agentId, purpose, model: t.model,
    input_tokens: t.usage.input, output_tokens: t.usage.output, cache_read_tokens: t.usage.cacheRead, cache_write_tokens: t.usage.cacheWrite,
    cost: t.costUsd, ...extra,
  }).select("id").single();
  if (t.costUsd > 0) await addClaudeSpend(companyId, t.costUsd);
  return data?.id as string;
}

/** Track spend in RM; notify the owner once per month when the cap is reached (rule 15). */
export async function addClaudeSpend(companyId: string, usd: number) {
  const { data: co } = await db().from("companies").select("settings").eq("id", companyId).single();
  const rate = Number(co?.settings?.usd_to_myr ?? 4.4);
  const total = Number((await db().rpc("add_spend", { p_company: companyId, p_provider: "claude", p_amount: usd * rate })).data ?? 0);
  const { data: cap } = await db().rpc("claude_cap_state", { p_company: companyId });
  if (cap?.cap_rm && total >= Number(cap.cap_rm) && total - usd * rate < Number(cap.cap_rm)) {
    const { data: owners } = await db().from("members").select("id").eq("company_id", companyId).eq("role", "owner").eq("status", "active");
    for (const o of owners ?? []) {
      await db().rpc("notify_member", { p_member: o.id, p_event: "spend_cap", p_title: "Claude monthly cap reached",
        p_body: `RM${total.toFixed(2)} of RM${cap.cap_rm} used. AI agents are now in Assist mode with drafts off until next month or a higher cap.`, p_link: "/settings/integrations" });
    }
  }
}

export async function capReached(companyId: string): Promise<boolean> {
  const { data } = await db().rpc("claude_cap_state", { p_company: companyId });
  return !!data?.cap_rm && Number(data.spent_rm) >= Number(data.cap_rm);
}

async function staffNameFor(conv: any, agent: AgentRow): Promise<string> {
  for (const id of [conv.holder_type === "staff" ? conv.holder_member_id : null, conv.contact?.owner_member_id, agent.default_staff_member_id]) {
    if (!id) continue;
    const { data } = await db().from("members").select("display_name").eq("id", id).maybeSingle();
    if (data) return data.display_name;
  }
  return "Muslimtravelbug";
}

async function transcriptFor(conversationId: string): Promise<TranscriptMessage[]> {
  const { data } = await db().from("messages").select("direction, sender_type, body, type, created_at, member:members(display_name)")
    .eq("conversation_id", conversationId).eq("is_internal_note", false).order("created_at", { ascending: false }).limit(40);
  return (data ?? []).reverse().map((m: any) => ({ ...m, staff_name: m.member?.display_name ?? null }));
}

// ---------------------------------------------------------------------------
// Router (section 7.1)
// ---------------------------------------------------------------------------
async function route(conv: any, company: any, model: ChatModel | null): Promise<string> {
  const { data: rules } = await db().from("routing_rules").select("*").eq("company_id", conv.company_id);
  const { data: latest } = await db().from("messages").select("body, meta").eq("conversation_id", conv.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).single();
  const text = latest?.body ?? "";
  const buttonId = latest?.meta?.button_id ?? null;
  let d = routeFirstMessage((rules ?? []) as RoutingRule[], { text, referralSourceId: conv.referral?.source_id ?? null, buttonId, allowAsk: conv.routing_state !== "asked" });

  // Haiku classifies free text only when ad/keywords were inconclusive.
  if ((d.kind === "ask" || (d.kind === "team" && d.via === "fallback")) && model && text.trim().length > 3) {
    const { data: agents } = await db().from("agents").select("id, name, destination, description, destination_keywords, status").eq("company_id", conv.company_id).neq("status", "resting");
    if (agents?.length) {
      const res = await model.call({
        purpose: "router", model: modelName(company.settings, "router"), maxTokens: 300, effort: "low",
        system: [{ type: "text", text: "Classify which travel package a WhatsApp customer message is about. Answer with JSON only." }],
        messages: [{ role: "user", content: `Packages:\n${agents.map((a) => `- ${a.id}: ${a.destination ?? a.name} (${a.description ?? ""}; ${a.destination_keywords.join(", ")})`).join("\n")}\n\nMessage: """${text.slice(0, 500)}"""\n\nReply {"agent_key": "<id>"} or {"agent_key": "unclear"}.` }],
        jsonSchema: { type: "object", additionalProperties: false, required: ["agent_key"], properties: { agent_key: { type: "string" } } },
      });
      await logRun(conv.company_id, conv.id, null, "router", { model: res.model, usage: res.usage, costUsd: res.costUsd }, { decision: "none" });
      const key = jsonOf<{ agent_key: string }>(res.content)?.agent_key;
      const hit = agents.find((a) => a.id === key);
      if (hit) d = { kind: "agent", agentId: hit.id, ruleId: "classifier", via: "classifier" };
    }
  }

  if (d.kind === "agent") {
    const { data: agent } = await db().from("agents").select("id, name, team_id").eq("id", d.agentId).single();
    await db().from("conversations").update({
      agent_id: agent!.id, team_id: conv.team_id ?? agent!.team_id, routing_state: "routed",
      ...(conv.holder_type === "staff" ? {} : { holder_type: "ai", holder_member_id: null, holder_since: new Date().toISOString() }),
    }).eq("id", conv.id);
    await db().rpc("add_system_event", { p_conv: conv.id, p_body: `Routed to ${agent!.name} (${d.via === "ad" ? "ad referral" : d.via})`, p_meta: { kind: "route", agent_id: agent!.id, via: d.via } });
    return "routed_agent";
  }
  if (d.kind === "team") {
    await db().from("conversations").update({ team_id: d.teamId, routing_state: "routed" }).eq("id", conv.id);
    const { data: team } = await db().from("teams").select("name").eq("id", d.teamId).single();
    await db().rpc("add_system_event", { p_conv: conv.id, p_body: `Routed to team ${team?.name} (${d.via})`, p_meta: { kind: "route", team_id: d.teamId, via: d.via } });
    // Automation: outside office hours for destinations without an agent.
    const { data: rule } = await db().from("automation_rules").select("enabled, config").eq("company_id", conv.company_id).eq("key", "out_of_hours").maybeSingle();
    if (rule?.enabled && !isWithinOfficeHours(new Date(), company.office_hours as OfficeHours, company.timezone)) {
      await sendViaGateway({ conversation_id: conv.id, kind: "text", sender_type: "system", purpose: "system", body: rule.config.message });
      await db().rpc("set_needs_staff", { p_conv: conv.id, p_reason: "Message outside office hours (no AI agent for this destination)" });
      await db().rpc("bump_automation", { p_company: conv.company_id, p_key: "out_of_hours" });
    }
    if (conv.holder_type !== "staff") await db().rpc("assign_round_robin", { p_conv: conv.id, p_team: d.teamId });
    return "routed_team";
  }
  if (d.kind === "ask") {
    await sendViaGateway({ conversation_id: conv.id, kind: "interactive", sender_type: "system", purpose: "router", interactive: { body: d.text, buttons: d.buttons } });
    await db().from("conversations").update({ routing_state: "asked" }).eq("id", conv.id);
    return "asked";
  }
  return "unrouted";
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function processConversation(conversationId: string, opts: { claim?: boolean; depth?: number } = {}): Promise<{ decision: string; reason?: string; run_id?: string }> {
  const depth = opts.depth ?? 0;
  if (opts.claim) {
    const { data: claimed } = await db().from("conversations").update({ ai_pending_since: null }).eq("id", conversationId).not("ai_pending_since", "is", null).select("id");
    if (!claimed?.length) return { decision: "already_handled" };
  }
  const runStartedAt = new Date().toISOString();
  const load = async () => (await db().from("conversations").select("*, contact:contacts(*), company:companies(id, settings, office_hours, timezone)").eq("id", conversationId).single()).data;
  let conv = await load();
  if (!conv) return { decision: "none", reason: "not_found" };
  const company = conv.company;
  const model = await modelFor(conv.company_id);

  if (!conv.agent_id && conv.routing_state !== "routed") {
    const r = await route(conv, company, model);
    if (r !== "routed_agent") return { decision: r };
    conv = await load();
  }
  if (!conv.agent_id) return { decision: "none", reason: "no_agent" };
  const { data: agent } = await db().from("agents").select("*").eq("id", conv.agent_id).single() as { data: AgentRow | null };
  if (!agent) return { decision: "none", reason: "agent_missing" };

  // --- work mode -------------------------------------------------------------
  if (await capReached(conv.company_id)) return { decision: "none", reason: "spend_cap_reached" };
  const officeHours = (agent as any).schedule?.office_hours ?? company.office_hours;
  let mode = effectiveMode(agent.mode as any, isWithinOfficeHours(new Date(), officeHours, company.timezone), { claudeConnected: !!model });
  if (agent.status === "resting") mode = "off";
  if (agent.status === "training" && mode === "auto") mode = "assist";
  if (conv.holder_type !== "ai" && mode === "auto") mode = "assist"; // staff holds, or handed over: drafts only
  if (mode === "off" || !model) return { decision: "none", reason: "agent_off" };

  // --- run ------------------------------------------------------------------
  const { data: labelRows } = await db().from("conversation_labels").select("label:labels(name)").eq("conversation_id", conv.id);
  const tb = await travelBoostFor(conv.company_id);
  const turn = await runAgentTurn({
    model, modelName: modelName(company.settings, "chat", agent.model_chat), tb, agent, conversation: conv, contact: conv.contact,
    transcript: await transcriptFor(conv.id), labels: (labelRows ?? []).map((l: any) => l.label.name), staffName: await staffNameFor(conv, agent),
  });
  const runId = await logRun(conv.company_id, conv.id, agent.id, mode === "auto" ? "reply" : "draft", turn, {
    mode, tool_calls: turn.effects.toolCalls, knowledge_versions: turn.knowledgeVersions, official_answer_id: turn.effects.officialAnswerId ?? null,
    latency_ms: Date.now() - Date.parse(runStartedAt), started_at: runStartedAt,
  });
  const finish = async (decision: string, reason?: string) => {
    await db().from("ai_runs").update({ decision, discard_reason: reason ?? null }).eq("id", runId);
    return { decision, reason, run_id: runId };
  };
  if (!turn.replies.length && !turn.effects.handover) return finish("none", "empty_reply");

  // --- assist: draft only -----------------------------------------------------
  if (mode === "assist") {
    await db().from("ai_drafts").update({ status: "superseded" }).eq("conversation_id", conv.id).eq("status", "pending");
    await db().from("ai_drafts").insert({
      company_id: conv.company_id, conversation_id: conv.id, ai_run_id: runId, agent_id: agent.id,
      body: turn.replies.join("\n\n"), seat_data: turn.effects.seatData ?? null,
    });
    await applyEffects(conv, agent, turn, { sent: false });
    return finish("draft");
  }

  // --- auto: rule 4 re-check right before sending ---------------------------
  const check = (await db().rpc("ai_try_commit", { p_conv: conv.id, p_run_started_at: runStartedAt, p_agent: agent.id })).data as string;
  if (check === "newer_inbound" && depth < 2) {
    await finish("rerun", check);
    return processConversation(conversationId, { depth: depth + 1 });
  }
  if (check !== "ok") return finish("discarded", check);

  await applyEffects(conv, agent, turn, { sent: true });
  for (const [idx, body] of turn.replies.entries()) {
    if (idx > 0) {
      const again = (await db().rpc("ai_try_commit", { p_conv: conv.id, p_run_started_at: runStartedAt, p_agent: agent.id })).data as string;
      if (again !== "ok") return finish("discarded", `stopped_after_${idx}_messages:${again}`);
    }
    const r = await sendViaGateway({ conversation_id: conv.id, kind: "text", body, sender_type: "ai", agent_id: agent.id, ai_run_id: runId, purpose: "reply" });
    if (!r.data.ok) return finish("discarded", `send_failed:${r.data.error}`);
  }
  for (const a of turn.effects.attachments) {
    await sendViaGateway({ conversation_id: conv.id, kind: "media", sender_type: "ai", agent_id: agent.id, ai_run_id: runId, media: { path: a.path, mime: a.mime, filename: a.filename } });
  }
  if (turn.effects.handover) await applyHandover(conv, agent, turn.effects.handover);
  else await scheduleCloseSaleFollowups(conv.id, agent.id, turn.effects);
  return finish(turn.effects.handover ? "handover" : "sent");
}

async function labelId(companyId: string, group: string, name: string): Promise<string | null> {
  const { data } = await db().from("labels").select("id").eq("company_id", companyId).eq("group", group).eq("name", name).maybeSingle();
  return data?.id ?? null;
}

async function applyEffects(conv: any, agent: AgentRow, turn: TurnResult, o: { sent: boolean }) {
  const e = turn.effects;
  for (const l of e.labels) {
    const id = await labelId(conv.company_id, l.group, l.name);
    if (id) await db().rpc("apply_label", { p_conv: conv.id, p_label: id, p_by_type: "ai", p_member: null, p_agent: agent.id, p_reason: l.reason, p_confirmed: l.group === "temperature" });
  }
  const pax = Number(e.keyDetails.pax ?? 0);
  if (pax >= 10) {
    const id = await labelId(conv.company_id, "attention", "Large group 10+");
    if (id) await db().rpc("apply_label", { p_conv: conv.id, p_label: id, p_by_type: "ai", p_member: null, p_agent: agent.id, p_reason: `${pax} pax`, p_confirmed: false });
  }
  if (Object.keys(e.keyDetails).length) {
    await db().from("conversations").update({ key_details: { ...(conv.key_details ?? {}), ...e.keyDetails } }).eq("id", conv.id);
  }
  if (o.sent && e.toolEvents.length) {
    await db().from("messages").insert(e.toolEvents.map((t) => ({
      company_id: conv.company_id, conversation_id: conv.id, direction: "out", sender_type: "ai", sender_agent_id: agent.id, type: "tool", body: t, status: "sent",
    })));
  }
  for (const key of e.followups) {
    const { data: step } = await db().from("followup_steps").select("id, delay_minutes").eq("company_id", conv.company_id).eq("key", key).maybeSingle();
    if (step) await db().from("followup_jobs").insert({ company_id: conv.company_id, conversation_id: conv.id, step_id: step.id, kind: "followup", step_key: key, due_at: new Date(Date.now() + step.delay_minutes * 60000).toISOString() });
  }
  if (e.handover && !o.sent) {
    // Assist mode: flag for staff, keep the draft for them.
    await db().rpc("set_needs_staff", { p_conv: conv.id, p_reason: e.handover.reason });
    await db().from("conversations").update({ ai_summary: e.handover.summary }).eq("id", conv.id);
  }
}

/** Handover (7.2): Needs staff with reason, team round-robin, AI summary note. The polite Malay reply was already sent. */
export async function applyHandover(conv: any, agent: AgentRow, h: { reason: string; summary: string }) {
  await db().rpc("set_needs_staff", { p_conv: conv.id, p_reason: h.reason });
  await db().from("messages").insert({
    company_id: conv.company_id, conversation_id: conv.id, direction: "out", sender_type: "ai", sender_agent_id: agent.id,
    type: "note", is_internal_note: true, status: "sent", body: `AI summary: ${h.summary}`,
  });
  await db().from("conversations").update({ ai_summary: h.summary, holder_type: "none", holder_member_id: null }).eq("id", conv.id);
  const team = agent.team_id ?? conv.team_id ?? (await db().from("teams").select("id").eq("company_id", conv.company_id).eq("is_general", true).limit(1).maybeSingle()).data?.id;
  if (team) await db().rpc("assign_round_robin", { p_conv: conv.id, p_team: team });
}

/** "Rewrite shorter" on an AI draft (Assist mode). */
export async function rewriteDraft(draftId: string, instruction: string): Promise<string> {
  const { data: d } = await db().from("ai_drafts").select("*, conversation:conversations(company_id, company:companies(settings))").eq("id", draftId).single();
  if (!d) throw new Error("draft_not_found");
  const model = await modelFor(d.conversation.company_id);
  if (!model) throw new Error("AI is not connected");
  const res = await model.call({
    purpose: "rewrite", model: modelName(d.conversation.company.settings, "chat"), maxTokens: 1000, effort: "low",
    system: [{ type: "text", text: "Rewrite the WhatsApp draft in Malaysian Malay. Keep every fact, date, price and link exactly. Use cik/puan, no Indonesian words. Output only the rewritten text." }],
    messages: [{ role: "user", content: `Make it ${instruction === "shorter" ? "shorter (about half)" : instruction}.\n\nDRAFT:\n${d.body}` }],
  });
  await logRun(d.conversation.company_id, d.conversation_id, d.agent_id, "draft", { model: res.model, usage: res.usage, costUsd: res.costUsd }, { decision: "draft" });
  const body = textOf(res.content) || d.body;
  await db().from("ai_drafts").update({ status: "superseded" }).eq("id", d.id);
  await db().from("ai_drafts").insert({ company_id: d.company_id, conversation_id: d.conversation_id, ai_run_id: d.ai_run_id, agent_id: d.agent_id, body, seat_data: d.seat_data });
  return body;
}

export { logRun };
