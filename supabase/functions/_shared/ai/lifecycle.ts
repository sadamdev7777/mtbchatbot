// Stage changes driven by TravelBoost / payments, and the follow-up queue they feed.
import { db } from "../db.ts";

/** Payment recorded → stage deposit / full_payment, agent switches to after-sales, schedule queued. */
export async function onPaymentRecorded(conversationId: string, p: { bookingId: string; paid: number; balance: number; amount: number; startDate: string | null }) {
  const stage = p.balance <= 0 ? "full_payment" : "deposit";
  const { data: before } = await db().from("conversations").select("stage, company_id, agent_id").eq("id", conversationId).single();
  await db().from("conversations").update({ stage, booking_ref: p.bookingId, templates_sent: 0, needs_staff: false, needs_staff_reason: null, needs_staff_since: null, ...(p.startDate ? { trip_date: p.startDate } : {}) }).eq("id", conversationId);
  await db().rpc("add_system_event", {
    p_conv: conversationId, p_body: `Payment RM${p.amount.toFixed(2)} recorded · ${p.bookingId} · stage ${stage === "deposit" ? "Deposit" : "Full payment"}`,
    p_meta: { kind: "stage", stage },
  });
  // close-sale follow-ups no longer apply
  await db().from("followup_jobs").update({ status: "cancelled", result: "paid" }).eq("conversation_id", conversationId).eq("status", "pending").eq("kind", "followup");
  if (before && before.stage !== "deposit" && before.stage !== "full_payment") await scheduleAftersales(conversationId);
}

/** After-sales schedule (on deposit, 60/50/45/7 days before the trip) as follow-up jobs. */
export async function scheduleAftersales(conversationId: string) {
  const { data: conv } = await db().from("conversations").select("id, company_id, agent_id, trip_date").eq("id", conversationId).single();
  if (!conv) return 0;
  const { data: steps } = await db().from("aftersales_schedule").select("*").eq("company_id", conv.company_id).eq("enabled", true)
    .or(`agent_id.is.null,agent_id.eq.${conv.agent_id ?? "00000000-0000-0000-0000-000000000000"}`);
  // agent-specific rows override company defaults with the same key
  const byKey = new Map<string, any>();
  for (const s of steps ?? []) if (!byKey.has(s.key) || s.agent_id) byKey.set(s.key, s);
  let n = 0;
  for (const s of byKey.values()) {
    let due: Date;
    if (s.days_before_trip === null) due = new Date();
    else if (conv.trip_date) due = new Date(Date.parse(conv.trip_date + "T09:00:00+08:00") - s.days_before_trip * 86400000);
    else continue;
    if (due.getTime() < Date.now() - 86400000 && s.days_before_trip !== null) continue; // already past
    const { error } = await db().from("followup_jobs").insert({
      company_id: conv.company_id, conversation_id: conv.id, kind: "aftersales", step_key: `aftersales:${s.key}`,
      payload: { action: s.action, template_name: s.template_name, days_before_trip: s.days_before_trip }, due_at: due.toISOString(),
    });
    if (!error) n++;
  }
  return n;
}

/** availability.low / product.dates_added → event follow-ups for leads who asked about that date or month. */
export async function queueEventFollowups(companyId: string, type: string, d: Record<string, any>): Promise<number> {
  const { data: convs } = await db().from("conversations").select("id, key_details, holder_type, stage")
    .eq("company_id", companyId).in("stage", ["lead", "booking"]).neq("status", "closed").limit(500);
  let n = 0;
  for (const c of convs ?? []) {
    const kd = (c.key_details ?? {}) as { asked_group_ids?: string[]; month?: string; product_ids?: string[] };
    const match = type === "availability.low"
      ? (kd.asked_group_ids ?? []).includes(d.group_id) && Number(d.available ?? 99) < 5
      : !!kd.month && String(d.start_date ?? d.month ?? "").startsWith(kd.month) && (!kd.product_ids?.length || kd.product_ids.includes(d.product_id));
    if (!match) continue;
    const key = type === "availability.low" ? "availability_low" : "dates_added";
    const { error } = await db().from("followup_jobs").insert({
      company_id: companyId, conversation_id: c.id, kind: "event", step_key: `${key}:${d.group_id ?? d.month ?? ""}`,
      payload: { event: type, ...d }, due_at: new Date().toISOString(),
    });
    if (!error) n++;
  }
  return n;
}

/** Steps for an agent: agent-specific rows override company defaults with the same key. */
export async function followupStepsFor(companyId: string, agentId: string | null) {
  const { data } = await db().from("followup_steps").select("*").eq("company_id", companyId)
    .or(`agent_id.is.null,agent_id.eq.${agentId ?? "00000000-0000-0000-0000-000000000000"}`).order("sort");
  const byKey = new Map<string, any>();
  for (const s of data ?? []) if (!byKey.has(s.key) || s.agent_id) byKey.set(s.key, s);
  return [...byKey.values()].filter((s) => s.enabled);
}

/**
 * After an AI reply in close-sale mode, (re)schedule the quiet-customer sequence (7.6):
 * price given → 3 h and 20 h free messages; asked for dates but no pax → 3 h; then templates
 * 3 days and 10 days after the customer's last message. Any customer reply cancels them.
 */
export async function scheduleCloseSaleFollowups(conversationId: string, agentId: string, effects: { seatData?: unknown; keyDetails: Record<string, unknown> }) {
  const { data: conv } = await db().from("conversations").select("id, company_id, stage, last_inbound_at, key_details").eq("id", conversationId).single();
  if (!conv || !["lead", "booking"].includes(conv.stage)) return 0;
  await db().from("followup_jobs").update({ status: "cancelled", result: "rescheduled" }).eq("conversation_id", conversationId).eq("status", "pending").eq("kind", "followup");
  const steps = await followupStepsFor(conv.company_id, agentId);
  const kd = { ...(conv.key_details ?? {}), ...effects.keyDetails } as Record<string, unknown>;
  const now = Date.now();
  const base = conv.last_inbound_at ? Date.parse(conv.last_inbound_at) : now;
  const triggers = new Set<string>(["quiet_after_window", "still_quiet"]);
  if (effects.seatData) triggers.add("price_given_quiet");
  else if (!kd.pax) triggers.add("asked_dates_no_pax");
  let n = 0;
  for (const s of steps.filter((x) => x.mode === "close_sale" && triggers.has(x.trigger))) {
    const due = ["quiet_after_window", "still_quiet"].includes(s.trigger) ? base + s.delay_minutes * 60000 : now + s.delay_minutes * 60000;
    const { error } = await db().from("followup_jobs").insert({ company_id: conv.company_id, conversation_id: conv.id, step_id: s.id, kind: "followup", step_key: s.key, due_at: new Date(due).toISOString() });
    if (!error) n++;
  }
  return n;
}
