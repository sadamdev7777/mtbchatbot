// TravelBoost webhook events → conversation state.
import { normalizePhone } from "../_shared/core/rules.ts";
import { db } from "../_shared/db.ts";
import { sendViaGateway } from "../_shared/functions.ts";
import { onPaymentRecorded, queueEventFollowups } from "../_shared/ai/lifecycle.ts";

export interface TbEvent { id: string; type: string; created_at: string; data: Record<string, any> }

async function conversationForPhone(companyId: string, phone: string | undefined) {
  if (!phone) return null;
  const { data: contact } = await db().from("contacts").select("id, name").eq("company_id", companyId).eq("wa_id", normalizePhone(phone)).maybeSingle();
  if (!contact) return null;
  const { data: conv } = await db().from("conversations").select("*").eq("contact_id", contact.id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return conv ? { conv, contact } : null;
}

async function conversationForBooking(companyId: string, bookingId: string | undefined, phone?: string) {
  if (bookingId) {
    const { data: conv } = await db().from("conversations").select("*, contact:contacts(id, name)").eq("company_id", companyId).eq("booking_ref", bookingId).maybeSingle();
    if (conv) return { conv, contact: conv.contact };
  }
  return conversationForPhone(companyId, phone);
}

export async function handleTravelBoostEvent(companyId: string, e: TbEvent): Promise<Record<string, unknown>> {
  const d = e.data ?? {};
  switch (e.type) {
    case "seat.locked": {
      const hit = await conversationForPhone(companyId, d.lead_phone);
      if (!hit) return { matched: false };
      await db().from("conversations").update({ booking_ref: d.booking_id, stage: "booking", trip_date: d.start_date ?? null }).eq("id", hit.conv.id);
      await db().rpc("add_system_event", { p_conv: hit.conv.id, p_body: `Seat locked in TravelBoost · ${d.booking_id} · ${d.pax} pax · ${d.start_date}`, p_meta: { kind: "travelboost", event: e.type } });
      // Close-sale step 6: staff sends the payment link.
      await db().rpc("set_needs_staff", { p_conv: hit.conv.id, p_reason: `Seat locked (${d.booking_id}): send payment link` });
      if (hit.conv.holder_type !== "staff") {
        const team = hit.conv.team_id ?? (await db().from("agents").select("team_id").eq("id", hit.conv.agent_id).maybeSingle()).data?.team_id;
        if (team) await db().rpc("assign_round_robin", { p_conv: hit.conv.id, p_team: team });
      }
      return { matched: true, conversation_id: hit.conv.id };
    }
    case "seat.lock_expired": {
      const hit = await conversationForBooking(companyId, d.booking_id, d.lead_phone);
      if (!hit) return { matched: false };
      await db().rpc("add_system_event", { p_conv: hit.conv.id, p_body: `Seat lock expired · ${d.booking_id ?? d.lock_id}`, p_meta: { kind: "travelboost", event: e.type } });
      await db().from("conversations").update({ stage: "lead" }).eq("id", hit.conv.id).eq("stage", "booking");
      const res = await sendViaGateway({
        conversation_id: hit.conv.id, kind: "template", sender_type: "system", purpose: "followup",
        template: { name: "seat_dilepaskan_v1", params: [hit.contact?.name ?? "Cik", d.product_name ?? "pakej MTB", d.start_date ?? ""] },
      });
      return { matched: true, template_sent: res.data.ok === true };
    }
    case "payment.recorded": {
      const hit = await conversationForBooking(companyId, d.booking_id, d.lead_phone);
      if (!hit) return { matched: false };
      await onPaymentRecorded(hit.conv.id, { bookingId: d.booking_id, paid: Number(d.paid ?? 0), balance: Number(d.balance ?? 0), amount: Number(d.amount ?? 0), startDate: d.start_date ?? null });
      return { matched: true };
    }
    case "booking.cancelled": {
      const hit = await conversationForBooking(companyId, d.booking_id, d.lead_phone);
      if (!hit) return { matched: false };
      await db().from("conversations").update({ stage: "lost", lost_reason: d.reason ?? "Booking cancelled in TravelBoost" }).eq("id", hit.conv.id);
      await db().rpc("add_system_event", { p_conv: hit.conv.id, p_body: `Booking ${d.booking_id} cancelled in TravelBoost`, p_meta: { kind: "travelboost", event: e.type } });
      await db().from("followup_jobs").update({ status: "cancelled", result: "booking_cancelled" }).eq("conversation_id", hit.conv.id).eq("status", "pending");
      return { matched: true };
    }
    case "availability.low":
    case "product.dates_added":
      return { queued: await queueEventFollowups(companyId, e.type, d) };
    default:
      return { ignored: e.type };
  }
}
