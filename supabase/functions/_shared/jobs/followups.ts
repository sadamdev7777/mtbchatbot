// Follow-up engine (7.6) and after-sales schedule (7.2), run every minute by followup-runner.
import { followupVerdict } from "../core/rules.ts";
import { isQuietHours, isWindowOpen, nextAllowedSendTime, type QuietHours } from "../core/time.ts";
import { monthLabelMs } from "../core/nlp.ts";
import { db } from "../db.ts";
import { sendViaGateway } from "../functions.ts";
import { travelBoostFor } from "../providers/travelboost.ts";
import { type AgentRow, runAgentTurn } from "../ai/agent.ts";
import { modelFor } from "../ai/model.ts";
import { addClaudeSpend, capReached, modelName } from "../ai/orchestrator.ts";
import { scheduleAftersales } from "../ai/lifecycle.ts";

const MARKETING_TEMPLATES_STOP = ["sebab_tak_jadi_v1"];

async function staffName(conv: any, agent: AgentRow | null): Promise<string> {
  for (const id of [conv.holder_type === "staff" ? conv.holder_member_id : null, conv.contact?.owner_member_id, agent?.default_staff_member_id]) {
    if (!id) continue;
    const { data } = await db().from("members").select("display_name").eq("id", id).maybeSingle();
    if (data) return data.display_name;
  }
  return "Muslimtravelbug";
}

/** A free AI follow-up written with the conversation context (no tools, one message). */
async function aiFollowup(conv: any, agent: AgentRow, hint: string): Promise<string | null> {
  if (await capReached(conv.company_id)) return null;
  const model = await modelFor(conv.company_id);
  if (!model) return null;
  const { data: msgs } = await db().from("messages").select("direction, sender_type, body, type, created_at").eq("conversation_id", conv.id)
    .eq("is_internal_note", false).order("created_at", { ascending: false }).limit(30);
  const tb = await travelBoostFor(conv.company_id);
  const turn = await runAgentTurn({
    model, modelName: modelName(conv.company.settings, "chat", agent.model_chat), tb, agent, conversation: conv, contact: conv.contact,
    transcript: (msgs ?? []).reverse() as any, labels: [], staffName: await staffName(conv, agent), maxToolRounds: 2,
    extraUserInstruction: `FOLLOW-UP TASK (from MTB systems, not the customer): the customer has gone quiet. Write ONE short, warm follow-up message in Malaysian Malay that moves toward booking. Never mention weather. HINT: ${hint}`,
  });
  if (turn.costUsd > 0) await addClaudeSpend(conv.company_id, turn.costUsd);
  await db().from("ai_runs").insert({ company_id: conv.company_id, conversation_id: conv.id, agent_id: agent.id, purpose: "followup", model: turn.model,
    input_tokens: turn.usage.input, output_tokens: turn.usage.output, cache_read_tokens: turn.usage.cacheRead, cache_write_tokens: turn.usage.cacheWrite, cost: turn.costUsd, decision: "sent" });
  return turn.replies[0] ?? null;
}

function templateParams(name: string, conv: any, staff: string, extra: Record<string, string> = {}): string[] {
  const cname = conv.contact?.name ?? "Cik";
  const dest = conv.key_details?.destination ?? extra.product ?? "pakej MTB";
  switch (name) {
    case "susulan_pertanyaan_v1": return [cname, staff, dest];
    case "sebab_tak_jadi_v1": return [cname, dest];
    case "review_selepas_trip_v1": return [cname, dest];
    case "minta_passport_v1": return [cname, dest, extra.trip_date ?? ""];
    case "peringatan_baki_v1": return [cname, extra.balance ?? "", conv.booking_ref ?? "", extra.due ?? ""];
    case "itinerary_akhir_v1": return [cname, dest, extra.trip_date ?? ""];
    default: return [cname];
  }
}

async function finish(jobId: string, status: string, result: string) {
  await db().from("followup_jobs").update({ status, result }).eq("id", jobId);
}

export async function runFollowups(now = new Date()): Promise<Record<string, number>> {
  const out: Record<string, number> = { sent: 0, waited: 0, cancelled: 0, reminded: 0, skipped: 0 };
  await markTripsDone(now);
  const { data: jobs } = await db().from("followup_jobs").select("*, step:followup_steps(*)").eq("status", "pending").lte("due_at", now.toISOString())
    .in("kind", ["followup", "aftersales", "event"]).order("due_at").limit(100);
  for (const job of jobs ?? []) {
    try {
      const r = await runJob(job, now);
      out[r] = (out[r] ?? 0) + 1;
    } catch (e) {
      console.error("followup job failed", job.id, e);
      await finish(job.id, "failed", String(e).slice(0, 300));
    }
  }
  return out;
}

async function runJob(job: any, now: Date): Promise<string> {
  const { data: conv } = await db().from("conversations").select("*, contact:contacts(*), company:companies(id, settings, timezone)").eq("id", job.conversation_id).single();
  if (!conv) { await finish(job.id, "cancelled", "no_conversation"); return "cancelled"; }
  const { data: agent } = conv.agent_id ? await db().from("agents").select("*").eq("id", conv.agent_id).single() : { data: null };
  const isAfter = job.kind === "aftersales";
  const step = job.step ?? {};
  const templateName: string | null = isAfter ? job.payload?.template_name ?? null : step.message_kind === "template" ? step.template_name : null;
  const isTemplate = !!templateName && (!isWindowOpen(conv.last_inbound_at, now) || !isAfter);
  const { data: tpl } = templateName ? await db().from("templates").select("category").eq("company_id", conv.company_id).eq("name", templateName).maybeSingle() : { data: null };
  const q = conv.company?.settings?.quiet_hours as QuietHours | undefined;

  const verdict = followupVerdict({
    customerRepliedSinceScheduled: !isAfter && !!conv.last_inbound_at && Date.parse(conv.last_inbound_at) > Date.parse(job.created_at),
    notInterested: conv.stage === "lost" && !isAfter,
    templatesSent: conv.templates_sent ?? 0,
    maxTemplates: Number(conv.company?.settings?.max_templates_per_enquiry ?? 2),
    isTemplateStep: isTemplate && !isAfter,
    holderType: conv.holder_type,
    quietHours: isQuietHours(now, q, conv.company?.timezone),
    optedOut: !!conv.contact?.opted_out_at,
    isMarketing: tpl?.category === "MARKETING",
    windowOpen: isWindowOpen(conv.last_inbound_at, now),
    isFreeStep: !isTemplate,
  });

  switch (verdict) {
    case "cancel_replied": await finish(job.id, "cancelled", "customer_replied"); return "cancelled";
    case "cancel_not_interested": await finish(job.id, "cancelled", "not_interested"); return "cancelled";
    case "cancel_template_cap": await finish(job.id, "cancelled", "template_cap"); return "cancelled";
    case "cancel_opted_out": await finish(job.id, "cancelled", "opted_out"); return "cancelled";
    case "wait_quiet":
      await db().from("followup_jobs").update({ due_at: nextAllowedSendTime(now, q, conv.company?.timezone).toISOString() }).eq("id", job.id);
      return "waited";
    case "skip_window_closed":
      // free follow-ups need the 24-hour window; aftersales fall back to their template when they have one
      await finish(job.id, "skipped", "window_closed");
      return "skipped";
    case "remind_staff":
      if (conv.holder_member_id) {
        await db().rpc("notify_member", { p_member: conv.holder_member_id, p_event: "team_unanswered", p_title: `Follow up ${conv.contact?.name ?? conv.contact?.wa_id}`,
          p_body: `Step "${job.step_key.replace("aftersales:", "")}" is due. You hold this chat, so the bot stays quiet.`, p_link: `/inbox?c=${conv.id}` });
      }
      await finish(job.id, "done", "reminded_staff");
      return "reminded";
  }

  // ---- send ----
  const staff = await staffName(conv, agent);
  const extra = await aftersalesExtras(conv);
  let ok = false;
  if (isTemplate && templateName) {
    const r = await sendViaGateway({ conversation_id: conv.id, kind: "template", sender_type: "system", purpose: isAfter ? "aftersales" : "followup",
      template: { name: templateName, params: templateParams(templateName, conv, staff, extra) } });
    ok = !!r.data.ok;
    if (!ok) { await finish(job.id, "failed", r.data.message ?? r.data.error ?? "send failed"); return "skipped"; }
    if (MARKETING_TEMPLATES_STOP.includes(templateName)) {
      await db().from("followup_jobs").update({ status: "cancelled", result: "sequence_finished" }).eq("conversation_id", conv.id).eq("status", "pending").eq("kind", "followup").neq("id", job.id);
    }
  } else if (agent) {
    const hint = isAfter ? aftersalesHint(job.payload?.action, extra) : step.prompt_hint ?? (job.kind === "event" ? eventHint(job.payload) : "Ask if they still want to book.");
    const body = await aiFollowup(conv, agent, hint);
    if (!body) { await finish(job.id, "skipped", "ai_unavailable"); return "skipped"; }
    const r = await sendViaGateway({ conversation_id: conv.id, kind: "text", sender_type: "ai", agent_id: agent.id, purpose: isAfter ? "aftersales" : "followup", body });
    ok = !!r.data.ok;
    if (ok && isAfter && ["thank_receipt_itinerary", "final_itinerary"].includes(job.payload?.action)) await sendItinerary(conv, agent.id);
  }
  if (isAfter && job.payload?.action === "balance_deadline" && Number(extra.balance_num ?? 0) > 0) {
    await db().rpc("set_needs_staff", { p_conv: conv.id, p_reason: `Balance RM${extra.balance} unpaid at the 45-day deadline` });
  }
  await finish(job.id, ok ? "done" : "failed", ok ? "sent" : "send_failed");
  return ok ? "sent" : "skipped";
}

async function aftersalesExtras(conv: any): Promise<Record<string, string>> {
  const extra: Record<string, string> = {};
  if (conv.trip_date) extra.trip_date = conv.trip_date;
  if (!conv.booking_ref) return extra;
  try {
    const b = await (await travelBoostFor(conv.company_id)).getBooking(conv.booking_ref);
    if (b) {
      extra.balance = b.balance.toLocaleString("en-MY");
      extra.balance_num = String(b.balance);
      extra.due = b.balance_due ?? "";
      extra.product = b.product_name;
      extra.trip_date = b.start_date;
      extra.passports_missing = String(b.passengers.filter((p) => !p.passport_received).length);
    }
  } catch { /* TravelBoost down: send without details */ }
  return extra;
}

function aftersalesHint(action: string, e: Record<string, string>): string {
  switch (action) {
    case "thank_receipt_itinerary": return "Thank the customer for the deposit, confirm the booking and say the receipt and itinerary PDF are attached.";
    case "collect_passports": return `Ask for passport copies of all travellers (${e.passports_missing ?? "some"} still missing) for the trip on ${e.trip_date ?? ""}.`;
    case "balance_reminder": return `Remind politely that the balance RM${e.balance ?? ""} is due by ${e.due ?? ""}.`;
    case "balance_deadline": return `Today is the balance deadline (RM${e.balance ?? ""}). Ask if they need help paying.`;
    case "final_itinerary": return `Send the final itinerary for the trip on ${e.trip_date ?? ""} and wish them a good trip.`;
    default: return "Check in about their booking.";
  }
}

function eventHint(p: Record<string, any>): string {
  if (p.event === "availability.low") return `Only ${p.available} seats are left on ${p.start_date}, the date the customer asked about. Offer to hold seats.`;
  return `New dates were opened for ${p.month ? monthLabelMs(String(p.month).slice(0, 7)) : "the month they wanted"}. Offer to check seats.`;
}

/** Sends the agent's active itinerary PDF. False when there is none or the send failed. */
export async function sendItinerary(conv: any, agentId: string): Promise<boolean> {
  const { data: itin } = await db().from("itineraries").select("file_path, file_name").eq("company_id", conv.company_id).eq("agent_id", agentId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!itin?.file_path) return false;
  const r = await sendViaGateway({ conversation_id: conv.id, kind: "media", sender_type: "ai", agent_id: agentId, purpose: "aftersales",
    media: { path: itin.file_path, mime: itin.file_path.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", filename: itin.file_name ?? "itinerary.pdf" } });
  return !!r.data.ok;
}

/** Trips that ended → stage trip_done + review template 3 days later. */
async function markTripsDone(now: Date) {
  const cutoff = new Date(now.getTime() - 5 * 86400000).toISOString().slice(0, 10);
  const { data } = await db().from("conversations").select("id, company_id, agent_id").in("stage", ["deposit", "full_payment"]).lt("trip_date", cutoff).limit(100);
  for (const c of data ?? []) {
    await db().from("conversations").update({ stage: "trip_done" }).eq("id", c.id);
    await db().rpc("add_system_event", { p_conv: c.id, p_body: "Trip finished · stage Trip done", p_meta: { kind: "stage", stage: "trip_done" } });
    const { data: step } = await db().from("followup_steps").select("id, delay_minutes, key").eq("company_id", c.company_id).eq("trigger", "trip_done").eq("enabled", true).limit(1).maybeSingle();
    if (step) await db().from("followup_jobs").insert({ company_id: c.company_id, conversation_id: c.id, step_id: step.id, kind: "followup", step_key: step.key, due_at: new Date(now.getTime() + step.delay_minutes * 60000).toISOString() });
  }
}

export { scheduleAftersales };
