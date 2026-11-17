// Night job phases (section 8). Each phase reads the day that just ended (Malaysia time) and writes
// into night_reports.phases + suggestions. Opus does the reading in real mode; the mock uses heuristics.
import { findBannedWords, INDONESIAN_WORDS, WEATHER_WORDS } from "../_shared/core/rules.ts";
import { localParts, zonedTime } from "../_shared/core/time.ts";
import { db } from "../_shared/db.ts";
import { sendViaGateway } from "../_shared/functions.ts";
import { jsonOf, modelFor, type ChatModel } from "../_shared/ai/model.ts";
import { addClaudeSpend, modelName } from "../_shared/ai/orchestrator.ts";
import { runAllScenarios } from "../_shared/ai/scenarios.ts";

export interface Ctx { companyId: string; reportId: string; reportDate: string; from: string; to: string; settings: Record<string, any>; model: ChatModel | null }

export const PHASES = ["audit", "staff_style", "deposit_compare", "proposals", "staff_audit", "test_changes", "report"] as const;
export type Phase = (typeof PHASES)[number];

/** The Malaysia-time day that just ended (night job runs 00:00–06:00 MYT). */
export function reportWindow(now: Date, tz = "Asia/Kuala_Lumpur") {
  const p = localParts(new Date(now.getTime() - 7 * 3600_000), tz); // 00:00–06:59 belongs to yesterday's report
  const start = zonedTime(p.year, p.month, p.day, 0, tz);
  return { date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, from: start.toISOString(), to: new Date(start.getTime() + 86400000).toISOString() };
}

export function phaseForHour(hourMyt: number): Phase | null {
  return hourMyt >= 0 && hourMyt <= 6 ? PHASES[hourMyt] : null;
}

const permission = (ctx: Ctx, key: string, dflt: string) => (ctx.settings?.night_job_permissions?.[key] ?? dflt) as string;

async function opus<T>(ctx: Ctx, system: string, user: string, schema: Record<string, unknown>): Promise<T | null> {
  if (!ctx.model || ctx.model.mode === "mock") return null;
  const res = await ctx.model.call({ purpose: "night", model: modelName(ctx.settings, "night"), maxTokens: 16000, effort: "high", system: [{ type: "text", text: system }], messages: [{ role: "user", content: user }], jsonSchema: schema });
  await addClaudeSpend(ctx.companyId, res.costUsd);
  await db().from("ai_runs").insert({ company_id: ctx.companyId, purpose: "night_job", model: res.model, input_tokens: res.usage.input, output_tokens: res.usage.output, cache_read_tokens: res.usage.cacheRead, cost: res.costUsd, decision: "none" });
  return jsonOf<T>(res.content);
}

async function suggest(ctx: Ctx, s: { kind: string; title: string; payload: Record<string, unknown>; evidence?: unknown[]; team_id?: string | null; auto_applied?: boolean; status?: string; applied_ref?: unknown }) {
  const { data } = await db().from("suggestions").insert({ company_id: ctx.companyId, night_report_id: ctx.reportId, ...s, evidence: s.evidence ?? [] }).select("id").single();
  return data?.id as string;
}

async function chatsOfDay(ctx: Ctx, senderType: "ai" | "staff") {
  const { data: msgs } = await db().from("messages").select("conversation_id").eq("company_id", ctx.companyId).eq("sender_type", senderType)
    .gte("created_at", ctx.from).lt("created_at", ctx.to).neq("type", "event").neq("type", "tool").eq("is_internal_note", false);
  const ids = [...new Set((msgs ?? []).map((m) => m.conversation_id))];
  const out: { id: string; agent_id: string | null; stage: string; needs_staff_reason: string | null; messages: { direction: string; sender_type: string; body: string | null; status: string; error_code: string | null; created_at: string; type: string }[] }[] = [];
  for (const id of ids) {
    const { data: c } = await db().from("conversations").select("id, agent_id, stage, needs_staff_reason").eq("id", id).single();
    const { data: m } = await db().from("messages").select("direction, sender_type, body, status, error_code, created_at, type").eq("conversation_id", id)
      .eq("is_internal_note", false).gte("created_at", ctx.from).lt("created_at", ctx.to).order("created_at");
    if (c) out.push({ ...c, messages: m ?? [] });
  }
  return out;
}

const strip = (b: string | null) => (b ?? "").replace(/^\*[^*\n]+\*\n/, "");

// ---------------------------------------------------------------------------
// 00:00 — audit all bot chats (all, not a sample)
// ---------------------------------------------------------------------------
async function audit(ctx: Ctx) {
  const chats = await chatsOfDay(ctx, "ai");
  const findings: { conversation_id: string; issue: string; detail: string }[] = [];
  for (const c of chats) {
    // group consecutive AI messages into turns: a turn that gives a price must end with a booking question
    let turn: string[] = [];
    const closeTurn = () => {
      if (turn.length && turn.some((b) => /RM\s?\d/.test(b)) && !/\?\s*$/.test(turn.at(-1)!)) findings.push({ conversation_id: c.id, issue: "price_no_booking_ask", detail: turn.join(" / ").slice(0, 160) });
      turn = [];
    };
    for (const m of c.messages) {
      if (m.sender_type !== "ai" || m.type !== "text") { if (m.direction === "in") closeTurn(); continue; }
      const body = strip(m.body);
      turn.push(body);
      if (/\b(penuh|full)\b/i.test(body)) findings.push({ conversation_id: c.id, issue: "wrong_seat_claim", detail: body.slice(0, 160) });
      const bad = [...findBannedWords(body, INDONESIAN_WORDS), ...findBannedWords(body, WEATHER_WORDS)];
      if (bad.length) findings.push({ conversation_id: c.id, issue: "style_break", detail: `Used: ${bad.join(", ")}` });
      if (m.status === "failed") findings.push({ conversation_id: c.id, issue: "failed_message", detail: `${m.error_code}` });
    }
    closeTurn();
    if (c.needs_staff_reason && /not (covered|in knowledge)/i.test(c.needs_staff_reason)) {
      const q = [...c.messages].reverse().find((m) => m.direction === "in");
      findings.push({ conversation_id: c.id, issue: "unanswered_question", detail: strip(q?.body ?? "").slice(0, 200) });
    }
  }
  // Opus reads every chat for invented facts and unanswered questions (batched).
  for (let i = 0; i < chats.length; i += 15) {
    const batch = chats.slice(i, i + 15);
    const r = await opus<{ findings: { conversation_id: string; issue: string; detail: string }[] }>(ctx,
      "You audit WhatsApp chats between a Malaysian travel agency's AI assistant and customers. Report only real problems: invented facts (anything not supported by tools/knowledge), wrong seat claims, questions the bot left unanswered, prices given without asking for the booking. JSON only.",
      batch.map((c) => `CHAT ${c.id}\n${c.messages.map((m) => `${m.direction === "in" ? "CUSTOMER" : m.sender_type.toUpperCase()}: ${strip(m.body)}`).join("\n")}`).join("\n\n"),
      { type: "object", additionalProperties: false, required: ["findings"], properties: { findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["conversation_id", "issue", "detail"], properties: {
        conversation_id: { type: "string" }, issue: { type: "string", enum: ["price_no_booking_ask", "unanswered_question", "invented_fact", "wrong_seat_claim", "style_break"] }, detail: { type: "string" } } } } } });
    for (const f of r?.findings ?? []) if (!findings.some((x) => x.conversation_id === f.conversation_id && x.issue === f.issue)) findings.push(f);
  }
  const { count: failed } = await db().from("messages").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "failed").gte("created_at", ctx.from).lt("created_at", ctx.to);
  const counts: Record<string, number> = { chats_audited: chats.length, failed_messages: failed ?? 0 };
  for (const f of findings) counts[f.issue] = (counts[f.issue] ?? 0) + 1;
  return { counts, findings: findings.slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 01:00 — staff chats → MTB language style (apply directly by default)
// ---------------------------------------------------------------------------
async function staffStyle(ctx: Ctx) {
  const chats = await chatsOfDay(ctx, "staff");
  const staffLines = chats.flatMap((c) => c.messages.filter((m) => m.sender_type === "staff").map((m) => strip(m.body))).filter((b) => b.length > 8).slice(0, 400);
  const { data: cur } = await db().from("knowledge_docs").select("id, content, version").eq("company_id", ctx.companyId).eq("scope", "company").eq("section", "language_style").eq("status", "active").maybeSingle();
  let additions: { rule: string; evidence: string[] }[] = [];
  const r = await opus<{ additions: { rule: string; evidence: string[] }[] }>(ctx,
    "You maintain a travel agency's WhatsApp language style guide (Malaysian Malay). From real staff messages, find NEW patterns worth teaching the AI (greetings, phrasing, how they confirm or follow up). Never contradict the existing rules. Max 3 additions, each with 1–3 short quotes as evidence. JSON only.",
    `CURRENT STYLE GUIDE:\n${cur?.content ?? ""}\n\nSTAFF MESSAGES (yesterday):\n${staffLines.join("\n")}`,
    { type: "object", additionalProperties: false, required: ["additions"], properties: { additions: { type: "array", items: { type: "object", additionalProperties: false, required: ["rule", "evidence"], properties: { rule: { type: "string" }, evidence: { type: "array", items: { type: "string" } } } } } } });
  if (r) additions = r.additions.slice(0, 3);
  else {
    // mock: staff end confirmations with "ya" → teach it if seen at least twice
    const yaa = staffLines.filter((l) => /\b(yaa?|ye)\s*[.!]?\s*$/i.test(l));
    if (yaa.length >= 2 && !/akhiri pengesahan/i.test(cur?.content ?? "")) additions = [{ rule: "Akhiri pengesahan ringkas dengan \"ya\" seperti staf (contoh: \"Baik cik, saya semak dulu ya.\").", evidence: yaa.slice(0, 3) }];
  }
  if (!additions.length) return { staff_messages: staffLines.length, additions: 0 };
  const content = `${cur?.content ?? "# Gaya bahasa MTB"}\n${additions.map((a) => `- ${a.rule}`).join("\n")}`;
  const mode = permission(ctx, "style", "apply");
  const { data: doc } = await db().from("knowledge_docs").insert({ company_id: ctx.companyId, scope: "company", section: "language_style", version: (cur?.version ?? 0) + 1, status: "draft", content, source: "night_job" }).select("id").single();
  if (mode === "apply") {
    await db().rpc("activate_knowledge", { p_doc: doc!.id, p_member: null });
    await suggest(ctx, { kind: "style", title: `Language style updated (v${(cur?.version ?? 0) + 1})`, payload: { additions, doc_id: doc!.id }, evidence: additions.flatMap((a) => a.evidence), auto_applied: true, status: "approved", applied_ref: { knowledge_doc_id: doc!.id, section: "language_style", scope: "company" } });
  } else {
    await suggest(ctx, { kind: "style", title: "Update the MTB language style", payload: { additions, doc_id: doc!.id }, evidence: additions.flatMap((a) => a.evidence) });
  }
  return { staff_messages: staffLines.length, additions: additions.length, applied: mode === "apply" };
}

// ---------------------------------------------------------------------------
// 02:00 — chats that reached a deposit vs those that didn't
// ---------------------------------------------------------------------------
async function depositCompare(ctx: Ctx) {
  const since = new Date(Date.parse(ctx.to) - 30 * 86400000).toISOString();
  const { data: convs } = await db().from("conversations").select("id, stage, agent_id, holder_type, last_staff_reply_at, created_at").eq("company_id", ctx.companyId).gte("created_at", since);
  const won = (convs ?? []).filter((c) => ["deposit", "full_payment", "trip_done"].includes(c.stage));
  const lost = (convs ?? []).filter((c) => ["lead", "lost"].includes(c.stage));
  const staffTouch = (list: typeof won) => list.length ? Math.round((list.filter((c) => c.last_staff_reply_at).length / list.length) * 100) : 0;
  const insights: string[] = [];
  const r = await opus<{ insights: string[] }>(ctx, "Compare what happened in chats that reached a deposit vs those that didn't. Give 3 concrete, actionable differences in what staff/bot did. JSON only.",
    JSON.stringify({ won: won.length, lost: lost.length, staff_touch_pct_won: staffTouch(won), staff_touch_pct_lost: staffTouch(lost) }),
    { type: "object", additionalProperties: false, required: ["insights"], properties: { insights: { type: "array", items: { type: "string" } } } });
  if (r) insights.push(...r.insights);
  else if (won.length || lost.length) insights.push(`${staffTouch(won)}% of chats that reached a deposit had a staff reply, vs ${staffTouch(lost)}% of those that didn't.`);
  return { won: won.length, not_won: lost.length, insights };
}

// ---------------------------------------------------------------------------
// 03:00 — proposals: official answers from staff answers, questions for the owner
// ---------------------------------------------------------------------------
async function proposals(ctx: Ctx) {
  const { data: handed } = await db().from("conversations").select("id, agent_id, needs_staff_reason").eq("company_id", ctx.companyId)
    .gte("updated_at", ctx.from).not("needs_staff_reason", "is", null);
  const { data: events } = await db().from("messages").select("conversation_id, body, meta, created_at").eq("company_id", ctx.companyId).eq("type", "event")
    .gte("created_at", ctx.from).lt("created_at", ctx.to).contains("meta", { kind: "needs_staff" });
  const convIds = [...new Set([...(handed ?? []).map((h) => h.id), ...(events ?? []).map((e) => e.conversation_id)])];
  let created = 0, questions = 0;
  for (const id of convIds) {
    const { data: msgs } = await db().from("messages").select("direction, sender_type, body, type, created_at, meta").eq("conversation_id", id).eq("is_internal_note", false).order("created_at");
    const ho = (msgs ?? []).findIndex((m) => m.type === "event" && /not (covered|in knowledge)/i.test(m.body ?? ""));
    if (ho < 0) continue;
    const question = [...(msgs ?? []).slice(0, ho)].reverse().find((m) => m.direction === "in")?.body ?? "";
    const staffAnswer = (msgs ?? []).slice(ho).find((m) => m.sender_type === "staff" && m.type === "text");
    const { data: conv } = await db().from("conversations").select("agent_id").eq("id", id).single();
    if (staffAnswer) {
      let qa = { question: question.slice(0, 200), answer: strip(staffAnswer.body).slice(0, 600) };
      const r = await opus<{ question: string; answer: string }>(ctx, "Turn a customer question and the staff's real answer into a reusable official answer in Malaysian Malay (cik/puan, no Indonesian words, no prices or seat counts). JSON only.",
        `CUSTOMER: ${question}\nSTAFF: ${strip(staffAnswer.body)}`, { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } });
      if (r) qa = r;
      const mode = permission(ctx, "official_answers", "suggest");
      if (mode === "apply") {
        const { data: oa } = await db().from("official_answers").insert({ company_id: ctx.companyId, scope: conv?.agent_id ? "agent" : "company", agent_id: conv?.agent_id ?? null, ...qa, source: "night_job" }).select("id").single();
        await suggest(ctx, { kind: "official_answer", title: `Official answer added: ${qa.question}`, payload: { ...qa, agent_id: conv?.agent_id ?? null }, evidence: [{ conversation_id: id }], auto_applied: true, status: "approved", applied_ref: { official_answer_id: oa?.id } });
      } else {
        await suggest(ctx, { kind: "official_answer", title: qa.question, payload: { ...qa, agent_id: conv?.agent_id ?? null }, evidence: [{ conversation_id: id, staff_answer: strip(staffAnswer.body).slice(0, 200) }] });
      }
      created++;
    } else if (question) {
      // nobody answered yet: ask the owner
      const { data: same } = await db().from("suggestions").select("id, payload").eq("company_id", ctx.companyId).eq("kind", "question").eq("status", "pending");
      const dup = (same ?? []).find((s) => String(s.payload?.question ?? "").toLowerCase() === question.toLowerCase());
      if (dup) await db().from("suggestions").update({ payload: { ...dup.payload, times: Number(dup.payload.times ?? 1) + 1 } }).eq("id", dup.id);
      else await suggest(ctx, { kind: "question", title: question.slice(0, 200), payload: { question: question.slice(0, 300), agent_id: conv?.agent_id ?? null, times: 1 }, evidence: [{ conversation_id: id }] });
      questions++;
    }
  }
  return { official_answers_proposed: created, questions_for_owner: questions };
}

// ---------------------------------------------------------------------------
// 04:00 — staff and leads audit
// ---------------------------------------------------------------------------
async function staffAudit(ctx: Ctx) {
  const now = Date.parse(ctx.to) + 4 * 3600_000;
  const { data: untouched } = await db().from("conversations").select("id, team_id, needs_staff_reason, needs_staff_since, contact:contacts(name, wa_id)")
    .eq("company_id", ctx.companyId).eq("needs_staff", true).lt("needs_staff_since", new Date(now - 12 * 3600_000).toISOString());
  for (const c of untouched ?? []) {
    const { data: pick } = c.team_id ? await db().rpc("pick_round_robin", { p_team: c.team_id, p_exclude: null }) : { data: null };
    const contact = c.contact as unknown as { name: string | null; wa_id: string };
    await suggest(ctx, { kind: "staff", team_id: c.team_id, title: `Needs-staff lead untouched for over 12 hours: ${contact?.name ?? contact?.wa_id}`,
      payload: { action: "reassign", conversation_id: c.id, member_id: pick ?? null, reason: c.needs_staff_reason }, evidence: [{ conversation_id: c.id, since: c.needs_staff_since }] });
  }
  const { data: teams } = await db().from("teams").select("id, name, lead_member_id, team_members(member:members(id, status, on_leave_until))").eq("company_id", ctx.companyId);
  const today = new Date(now).toISOString().slice(0, 10);
  let thin = 0;
  for (const t of teams ?? []) {
    const active = (t.team_members as any[]).map((x) => x.member).filter((m) => m?.status === "active" && (!m.on_leave_until || m.on_leave_until < today));
    if (active.length < 2) {
      thin++;
      await suggest(ctx, { kind: "staff", team_id: t.id, title: `Team ${t.name} has fewer than 2 active staff`, payload: { action: "staff_team", team_id: t.id, active: active.length } });
    }
  }
  // Coaching notes go to team leads
  const coach = permission(ctx, "coaching", "team_lead");
  const { data: slow } = await db().from("conversations").select("holder_member_id, team_id").eq("company_id", ctx.companyId).eq("holder_type", "staff").eq("needs_staff", true);
  const byMember = new Map<string, number>();
  for (const s of slow ?? []) if (s.holder_member_id) byMember.set(s.holder_member_id, (byMember.get(s.holder_member_id) ?? 0) + 1);
  let coached = 0;
  for (const [member, n] of byMember) {
    if (n < 3 || coach === "off") continue;
    const { data: m } = await db().from("members").select("display_name, team_members(team:teams(lead_member_id))").eq("id", member).single();
    const lead = (m?.team_members as any[])?.[0]?.team?.lead_member_id;
    if (lead) {
      await db().rpc("notify_member", { p_member: lead, p_event: "morning_report", p_title: `Coaching note: ${m?.display_name}`, p_body: `${n} chats held by ${m?.display_name} still need staff attention.`, p_link: "/morning-report" });
      coached++;
    }
  }
  // labels unused for 60 days
  const { data: stale } = await db().from("labels").select("id, name, last_used_at, created_at").eq("company_id", ctx.companyId).eq("group", "custom");
  for (const l of stale ?? []) {
    if (now - Date.parse(l.last_used_at ?? l.created_at) > 60 * 86400000) await suggest(ctx, { kind: "label", title: `Remove label "${l.name}" (unused for 60 days)`, payload: { label_id: l.id } });
  }
  return { untouched_needs_staff: untouched?.length ?? 0, thin_teams: thin, coaching_notes: coached };
}

// ---------------------------------------------------------------------------
// 05:00 — run all test scenarios against the proposed changes; drop changes that fail
// ---------------------------------------------------------------------------
async function testChanges(ctx: Ctx) {
  const { data: pending } = await db().from("suggestions").select("id, kind, payload, auto_applied, applied_ref").eq("night_report_id", ctx.reportId).in("kind", ["style", "knowledge"]);
  const { data: agents } = await db().from("agents").select("id").eq("company_id", ctx.companyId).eq("status", "live");
  let dropped = 0, kept = 0;
  for (const s of pending ?? []) {
    const { data: doc } = await db().from("knowledge_docs").select("scope, section, content").eq("id", s.payload.doc_id).maybeSingle();
    if (!doc) continue;
    let failed = 0;
    for (const a of agents ?? []) {
      const run = await runAllScenarios(ctx.companyId, a.id, { knowledge: "live", knowledge_override: [{ scope: doc.scope, section: doc.section, content: doc.content }], context: "night_job" });
      failed += run.total - run.passed;
    }
    if (failed) {
      dropped++;
      if (s.auto_applied) await db().rpc("rollback_knowledge", { p_company: ctx.companyId, p_scope: doc.scope, p_agent: null, p_section: doc.section, p_member: null });
      await db().from("suggestions").update({ status: "rejected", payload: { ...s.payload, dropped_reason: `${failed} scenario(s) failed` } }).eq("id", s.id);
    } else kept++;
  }
  return { tested: (pending ?? []).length, kept, dropped };
}

// ---------------------------------------------------------------------------
// 06:00 — morning report: screen + WhatsApp template to the owner
// ---------------------------------------------------------------------------
async function report(ctx: Ctx) {
  const { data: r } = await db().from("night_reports").select("phases").eq("id", ctx.reportId).single();
  const ph = r?.phases ?? {};
  const { count: chats } = await db().from("conversations").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).gte("last_message_at", ctx.from).lt("last_message_at", ctx.to);
  const { count: deposits } = await db().from("messages").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("type", "event").gte("created_at", ctx.from).lt("created_at", ctx.to).contains("meta", { kind: "stage", stage: "deposit" });
  const { count: pending } = await db().from("suggestions").select("id", { count: "exact", head: true }).eq("company_id", ctx.companyId).eq("status", "pending");
  const summary = {
    chats: chats ?? 0, deposits: deposits ?? 0, pending_suggestions: pending ?? 0,
    chats_audited: ph.audit?.counts?.chats_audited ?? 0, price_no_booking_ask: ph.audit?.counts?.price_no_booking_ask ?? 0,
    unanswered_questions: ph.audit?.counts?.unanswered_question ?? 0, untouched_needs_staff: ph.staff_audit?.untouched_needs_staff ?? 0,
    insights: ph.deposit_compare?.insights ?? [],
  };
  const body = [
    `Morning report · ${ctx.reportDate}`,
    `${summary.chats_audited} bot chats audited (all, not a sample).`,
    `${summary.price_no_booking_ask} price(s) given without a booking ask · ${summary.unanswered_questions} unanswered question(s) · ${summary.untouched_needs_staff} needs-staff lead(s) untouched for 12+ hours.`,
    `${summary.pending_suggestions} suggestion(s) waiting for approval.`,
    ...summary.insights,
  ].join("\n");
  await db().from("night_reports").update({ summary, body, status: "ready" }).eq("id", ctx.reportId);

  const { data: admins } = await db().from("members").select("id").eq("company_id", ctx.companyId).in("role", ["owner", "admin"]).eq("status", "active");
  for (const a of admins ?? []) await db().rpc("notify_member", { p_member: a.id, p_event: "morning_report", p_title: "Morning report is ready", p_body: `${summary.pending_suggestions} suggestion(s) to review`, p_link: "/morning-report" });

  // WhatsApp to the owner via the approved template
  const number = String(ctx.settings?.owner_report_number ?? "").replace(/\D/g, "");
  let whatsapp = "no owner number";
  if (number) {
    const { data: ch } = await db().from("channels").select("id").eq("company_id", ctx.companyId).order("created_at").limit(1).single();
    const { data: ct } = await db().from("contacts").upsert({ company_id: ctx.companyId, wa_id: number, name: "Owner (morning report)" }, { onConflict: "company_id,wa_id" }).select("id").single();
    const { data: cv } = await db().from("conversations").upsert({ company_id: ctx.companyId, channel_id: ch!.id, contact_id: ct!.id, status: "closed" }, { onConflict: "channel_id,contact_id" }).select("id").single();
    const d = new Date(ctx.reportDate + "T00:00:00Z").toLocaleDateString("ms-MY", { day: "numeric", month: "short" });
    const res = await sendViaGateway({ conversation_id: cv!.id, kind: "template", sender_type: "system", purpose: "system",
      template: { name: "laporan_pagi_v1", params: [d, String(summary.chats), String(summary.deposits), String(summary.pending_suggestions)] } });
    whatsapp = res.data.ok ? "sent" : `not sent: ${res.data.message ?? res.data.error}`;
    if (res.data.ok) await db().from("night_reports").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", ctx.reportId);
  }
  return { ...summary, whatsapp };
}

export async function runPhase(ctx: Ctx, phase: Phase) {
  const fn = { audit, staff_style: staffStyle, deposit_compare: depositCompare, proposals, staff_audit: staffAudit, test_changes: testChanges, report }[phase];
  const started = Date.now();
  let result: Record<string, unknown>;
  try {
    result = { ok: true, ...(await fn(ctx)) };
  } catch (e) {
    console.error("night phase", phase, e);
    result = { ok: false, error: (e as Error).message };
  }
  const { data: r } = await db().from("night_reports").select("phases").eq("id", ctx.reportId).single();
  await db().from("night_reports").update({ phases: { ...(r?.phases ?? {}), [phase]: { ...result, ran_at: new Date().toISOString(), ms: Date.now() - started } } }).eq("id", ctx.reportId);
  return result;
}

export async function contextFor(companyId: string, now: Date): Promise<Ctx> {
  const { data: co } = await db().from("companies").select("settings, timezone").eq("id", companyId).single();
  const w = reportWindow(now, co?.timezone);
  const { data: rep } = await db().from("night_reports").upsert({ company_id: companyId, report_date: w.date }, { onConflict: "company_id,report_date" }).select("id").single();
  return { companyId, reportId: rep!.id, reportDate: w.date, from: w.from, to: w.to, settings: co?.settings ?? {}, model: await modelFor(companyId) };
}
