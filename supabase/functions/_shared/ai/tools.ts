// Claude tool schemas (section 7.4) and their executor. Side effects (handover, labels, follow-ups)
// are collected as "effects" and only applied when the reply is committed (rule 4).
import { capRows, MAX_ROWS, normalizePhone } from "../core/rules.ts";
import { dayMonthMs, monthLabelMs } from "../core/nlp.ts";
import { db } from "../db.ts";
import type { TravelBoostProvider } from "../providers/travelboost.ts";
import type { ToolDef } from "./model.ts";

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "search_products", strict: true,
    description: "Live departure dates, prices and seats from TravelBoost. The ONLY source for dates, prices and seat counts. Returns at most 8 dates: dates with available >= pax first, then the nearest alternatives. `available` means seats still free. Search one month at a time.",
    input_schema: { type: "object", additionalProperties: false, required: ["destination", "month", "pax"], properties: {
      destination: { type: "string", description: "Destination or package keyword, e.g. 'Kundasang'" },
      month: { type: "string", description: "Month as YYYY-MM" },
      pax: { type: "integer", description: "Total travellers (adults + children)" },
    } },
  },
  {
    name: "get_package_info", strict: true,
    description: "Inclusions, exclusions, hotels, the itinerary for a day, and the itinerary PDF link for a TravelBoost product.",
    input_schema: { type: "object", additionalProperties: false, required: ["product_id", "topic"], properties: {
      product_id: { type: "string" }, topic: nullable("string", "Optional focus, e.g. 'hari 2', 'hotel', 'termasuk'"),
    } },
  },
  {
    name: "get_official_answer", strict: true,
    description: "Look up the company's official answer for a customer question. Official answers override everything else.",
    input_schema: { type: "object", additionalProperties: false, required: ["question"], properties: { question: { type: "string" } } },
  },
  {
    name: "create_seat_lock_link", strict: true,
    description: "Create a TravelBoost seat-lock link (24-hour hold). Only after the customer chose a date and gave the lead guest's name (and IC/email).",
    input_schema: { type: "object", additionalProperties: false, required: ["group_id", "pax", "lead_name", "lead_phone", "lead_email"], properties: {
      group_id: { type: "string" }, pax: { type: "integer" }, lead_name: { type: "string" },
      lead_phone: nullable("string", "Leave null to use the WhatsApp number of this chat"), lead_email: nullable("string", "Email if given"),
    } },
  },
  {
    name: "get_booking", strict: true,
    description: "Booking status, travellers and passports for this customer's booking.",
    input_schema: { type: "object", additionalProperties: false, required: ["booking_ref"], properties: { booking_ref: { type: "string" } } },
  },
  {
    name: "check_payment", strict: true,
    description: "Payment status of this customer's booking: paid, balance, due date.",
    input_schema: { type: "object", additionalProperties: false, required: ["booking_ref"], properties: { booking_ref: { type: "string" } } },
  },
  {
    name: "handover_to_staff", strict: true,
    description: "Hand the chat to a human. Use when: the customer asks for a person; the question is not covered by knowledge or an official answer; seats are not enough and the customer insists; a payment issue or complaint; you failed to understand twice; or the customer needs something the tools can't do.",
    input_schema: { type: "object", additionalProperties: false, required: ["reason", "summary"], properties: {
      reason: { type: "string", description: "Short reason staff will see, in English" },
      summary: { type: "string", description: "2–3 sentence summary of the chat for staff, in English" },
    } },
  },
  {
    name: "set_label", strict: true,
    description: "Set Temperature (HOT, WARM, COLD) from buying signals, or suggest an Attention label (VIP, Complaint, Large group 10+) for staff to confirm.",
    input_schema: { type: "object", additionalProperties: false, required: ["group", "name", "reason"], properties: {
      group: { type: "string", enum: ["temperature", "attention"] }, name: { type: "string", enum: ["HOT", "WARM", "COLD", "VIP", "Complaint", "Large group 10+"] },
      reason: { type: "string" },
    } },
  },
  {
    name: "schedule_followup", strict: true,
    description: "Schedule a follow-up step if the customer goes quiet.",
    input_schema: { type: "object", additionalProperties: false, required: ["step_key"], properties: {
      step_key: { type: "string", enum: ["dates_no_pax", "price_quiet_1", "lock_unpaid_1"] },
    } },
  },
  {
    name: "send_itinerary_pdf", strict: true,
    description: "Send the itinerary PDF of a product to the customer.",
    input_schema: { type: "object", additionalProperties: false, required: ["product_id"], properties: { product_id: { type: "string" } } },
  },
];

export interface Effects {
  handover?: { reason: string; summary: string };
  labels: { group: string; name: string; reason: string }[];
  followups: string[];
  lockLink?: { url: string; expires_at: string; group_id: string };
  attachments: { path: string; mime: string; filename: string }[];
  toolEvents: string[];
  toolCalls: { name: string; input: unknown; summary: string; ms: number }[];
  seatData?: { checked_at: string; summary: string; rows: unknown[] };
  keyDetails: Record<string, unknown>;
  officialAnswerId?: string;
}

export function newEffects(): Effects {
  return { labels: [], followups: [], attachments: [], toolEvents: [], toolCalls: [], keyDetails: {} };
}

export interface ToolContext {
  companyId: string;
  conversation: { id: string; booking_ref: string | null; key_details: Record<string, unknown> };
  contact: { wa_id: string; name: string | null };
  agent: { id: string; name: string; travelboost_product_ids: string[]; destination: string };
  tb: TravelBoostProvider;
  effects: Effects;
}

async function ownsBooking(ctx: ToolContext, ref: string) {
  const b = await ctx.tb.getBooking(ref);
  if (!b) return { booking: null, error: "Booking not found" };
  if (normalizePhone(b.lead_phone) !== normalizePhone(ctx.contact.wa_id) && ctx.conversation.booking_ref !== ref) {
    return { booking: null, error: "This booking does not belong to this WhatsApp number. Hand over to staff." };
  }
  return { booking: b, error: null };
}

export async function executeTool(name: string, input: any, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  const e = ctx.effects;
  let out: unknown;
  let summary = name;
  switch (name) {
    case "search_products": {
      const pax = Math.max(1, Number(input.pax ?? 1));
      const r = await ctx.tb.searchProducts({ destination: input.destination || ctx.agent.destination, product_ids: ctx.agent.travelboost_product_ids, month: input.month, pax });
      const rows = capRows(r.rows, MAX_ROWS).map((x) => ({
        group_id: x.group_id, product_id: x.product_id, start_date: x.start_date, end_date: x.end_date,
        price_adult: x.price_adult, price_child: x.price_child, price_infant: x.price_infant, available: x.available, deposit: x.deposit,
      }));
      out = { month: input.month, pax, total_dates_in_month: r.total, exact_matches: r.exactMatches, rows };
      summary = `search_products · ${input.destination || ctx.agent.destination} · ${input.month ? monthLabelMs(input.month) : "any"} · ${rows.length} results`;
      e.seatData = { checked_at: new Date().toISOString(), summary: rows.slice(0, 3).map((x) => `${dayMonthMs(x.start_date)}: ${x.available} seats`).join(", "), rows };
      e.keyDetails = { ...e.keyDetails, month: input.month, pax, destination: ctx.agent.destination,
        asked_group_ids: rows.map((x) => x.group_id), product_ids: [...new Set(rows.map((x) => x.product_id))] };
      break;
    }
    case "get_package_info": {
      const p = await ctx.tb.getProduct(input.product_id || ctx.agent.travelboost_product_ids[0]);
      if (!p) { out = { error: "Product not found" }; break; }
      const day = Number(String(input.topic ?? "").match(/\d+/)?.[0] ?? 0);
      const { data: itin } = await db().from("itineraries").select("file_path").eq("company_id", ctx.companyId).eq("travelboost_product_id", p.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
      out = { ...p, itinerary: day ? p.itinerary.filter((d) => d.day === day) : p.itinerary, itinerary_pdf_available: !!itin?.file_path || !!p.itinerary_pdf_url };
      summary = `get_package_info · ${p.name}${input.topic ? ` · ${input.topic}` : ""}`;
      break;
    }
    case "get_official_answer": {
      const { data } = await db().rpc("match_official_answer", { p_company: ctx.companyId, p_agent: ctx.agent.id, p_question: String(input.question ?? "") });
      const hit = (data as { id: string; question: string; answer: string; score: number }[] | null)?.[0];
      out = hit ? { found: true, question: hit.question, answer: hit.answer } : { found: false };
      if (hit) e.officialAnswerId = hit.id;
      summary = `get_official_answer · ${hit ? `matched "${hit.question}"` : "no match"}`;
      break;
    }
    case "create_seat_lock_link": {
      try {
        const link = await ctx.tb.createLockLink({
          group_id: input.group_id, pax: Number(input.pax), lead_name: input.lead_name,
          lead_phone: normalizePhone(input.lead_phone || ctx.contact.wa_id), lead_email: input.lead_email ?? null,
        });
        e.lockLink = { url: link.url, expires_at: link.expires_at, group_id: input.group_id };
        e.labels.push({ group: "temperature", name: "HOT", reason: "Asked to lock seats" });
        out = { url: link.url, expires_at: link.expires_at, hold_hours: 24 };
        summary = `create_seat_lock_link · ${input.group_id} · ${input.pax} pax`;
      } catch (err) {
        out = { error: (err as Error).message };
        summary = `create_seat_lock_link · failed`;
      }
      break;
    }
    case "get_booking":
    case "check_payment": {
      const { booking, error } = await ownsBooking(ctx, String(input.booking_ref));
      if (!booking) { out = { found: false, error }; summary = `${name} · not found`; break; }
      out = name === "get_booking"
        ? { found: true, id: booking.id, status: booking.status, product: booking.product_name, start_date: booking.start_date, pax: booking.pax,
            passengers: booking.passengers.map((p) => ({ name: p.name, passport_received: p.passport_received })) }
        : { found: true, booking_id: booking.id, paid: booking.paid, balance: booking.balance, balance_due: booking.balance_due, total: booking.total };
      summary = `${name} · ${booking.id}`;
      break;
    }
    case "handover_to_staff":
      e.handover = { reason: String(input.reason), summary: String(input.summary) };
      out = { ok: true, note: "Staff will be notified. Tell the customer politely in Malay that a staff member will continue and roughly when." };
      summary = `handover_to_staff · ${input.reason}`;
      break;
    case "set_label":
      e.labels.push({ group: input.group, name: input.name, reason: input.reason });
      out = { ok: true };
      summary = `set_label · ${input.name}`;
      break;
    case "schedule_followup":
      e.followups.push(String(input.step_key));
      out = { ok: true };
      summary = `schedule_followup · ${input.step_key}`;
      break;
    case "send_itinerary_pdf": {
      const { data: itin } = await db().from("itineraries").select("file_path, file_name").eq("company_id", ctx.companyId)
        .eq("travelboost_product_id", input.product_id || ctx.agent.travelboost_product_ids[0]).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!itin?.file_path) { out = { error: "No itinerary PDF uploaded for this product yet. Offer to have staff send it." }; summary = "send_itinerary_pdf · none"; break; }
      e.attachments.push({ path: itin.file_path, mime: itin.file_path.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", filename: itin.file_name ?? "itinerary.pdf" });
      out = { ok: true, note: "The PDF will be sent with your reply." };
      summary = `send_itinerary_pdf · ${itin.file_name}`;
      break;
    }
    default:
      out = { error: `Unknown tool ${name}` };
  }
  e.toolCalls.push({ name, input, summary, ms: Date.now() - started });
  e.toolEvents.push(`Tool: ${summary}`);
  return out;
}
