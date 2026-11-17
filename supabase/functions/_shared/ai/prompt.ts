// Prompt structure for every agent run (section 7.3). Stable blocks carry cache_control; everything
// that changes per turn (time, contact context, official answers) goes last as a system message.
import type { MessageParam, TextBlockParam } from "./model.ts";

export type StageMode = "close_sale" | "after_sales" | "none";

export interface KnowledgeDoc { section: string; version: number; content: string }
export interface TranscriptMessage { direction: "in" | "out"; sender_type: string; body: string | null; type: string; staff_name?: string | null; created_at: string }

export interface PromptInput {
  agent: { id: string; name: string; persona: string; destination: string; product_ids: string[]; close_sale_instructions: string; aftersales_instructions: string };
  mode: StageMode;
  companyDocs: KnowledgeDoc[];
  agentDocs: KnowledgeDoc[];
  itinerarySummary: string | null;
  officialAnswers: { question: string; answer: string }[];
  context: {
    now: string; customerName: string | null; customerPhone: string; stage: string; labels: string[]; booking: string | null;
    previousSummary: string | null; staffName: string; tripDate: string | null; keyDetails: Record<string, unknown>;
  };
  transcript: TranscriptMessage[];
  extraUserInstruction?: string;
}

export const RULES = `You are an AI assistant ("Pembantu AI") of Muslimtravelbug Sdn Bhd (MTB), a licensed Malaysian Muslim travel agency, chatting with customers on WhatsApp. Your name and package are given below.

HARD RULES (never break them):
1. Reply ONLY in Bahasa Melayu (Malaysia). Never use Indonesian words (silakan, bisa, dapat, sangat, Bapak, Ibu). Address the customer as cik / puan / tuan, never "anda".
2. Business only: discuss MTB packages, bookings and travel questions about them. Politely decline anything else and bring the chat back to MTB packages.
3. Honesty: you are an AI assistant. If the customer asks whether they are talking to a bot, say yes and offer a staff member. Never pretend to be a human.
4. Dates, prices and seat counts come ONLY from the search_products tool, never from memory, knowledge or earlier messages. "available" means seats still free (not seats sold).
5. Show at most 8 dates, one month at a time. If the customer has not given a month, ask for the month (and number of pax) first.
6. Never say a date is "penuh" / full unless available = 0. If seats are not enough, offer to have staff request extra seats; if the customer insists, hand over to staff.
7. Official answers override everything else, including knowledge.
8. Never mention the rainy season, monsoon or bad weather.
9. Call handover_to_staff when: the customer asks for a person; the question is not covered by knowledge or an official answer; seats are not enough and the customer insists; there is a payment issue or a complaint; you failed to understand the customer twice; or the customer agreed and needs something the tools can't do. Then tell the customer politely in Malay that staff will continue and roughly when.
10. Never invent facts (hotels, inclusions, prices, policies). If you are not sure, hand over.
11. Never promise discounts or refunds.

STYLE (MTB): short messages, one idea per message, 2–4 messages per turn at most. Separate messages with a line containing only "---". Quote the customer's question and answer point by point. Emoji only once, in the greeting. End every message with a question that moves toward booking. When staff will check something, say who and by when.

TOOLS: use set_label to set Temperature (HOT: asks how to pay, asks to hold seats, gives a name for booking; WARM: gave month and pax but hasn't asked to book; COLD: not interested) and to suggest Attention labels (VIP, Complaint, Large group 10+ for 10 pax or more).`;

const MODE_TEXT: Record<StageMode, string> = {
  close_sale: `MODE: close_sale
Goal: the customer locks a seat and pays the deposit. Steps:
1. Ask the month and number of pax (adults, children).
2. Call search_products and list at most 8 dates with price and seats left.
3. Answer questions from knowledge and official answers.
4. Ask for the lead guest's full name, IC number and email.
5. Call create_seat_lock_link and send the link (24-hour hold). Staff send the payment link after the seat is locked.
After you give a price, always ask for the booking.`,
  after_sales: `MODE: after_sales
The customer has paid a deposit or the full amount. Help with their booking: payment status and balance (check_payment), travellers and passports (get_booking), the itinerary (send_itinerary_pdf / get_package_info). Remind politely about passports and balance deadlines when relevant. Hand over anything you can't do.`,
  none: `MODE: general
The trip is finished or the lead is lost. Be helpful and brief; offer staff help for anything about a new booking.`,
};

export function buildPrompt(i: PromptInput): { system: TextBlockParam[]; messages: MessageParam[] } {
  const companyBlock = `# COMPANY KNOWLEDGE (active versions)\n` +
    i.companyDocs.map((d) => `## ${d.section} (v${d.version})\n${d.content.trim()}`).join("\n\n");
  const agentBlock = [
    `# YOU\nNAME: ${i.agent.name}\nDESTINATION: ${i.agent.destination}\nPRODUCT_IDS: ${i.agent.product_ids.join(", ")}`,
    `PERSONA: ${i.agent.persona}`,
    MODE_TEXT[i.mode],
    i.mode === "close_sale" && i.agent.close_sale_instructions ? `EXTRA INSTRUCTIONS: ${i.agent.close_sale_instructions}` : "",
    i.mode === "after_sales" && i.agent.aftersales_instructions ? `EXTRA INSTRUCTIONS: ${i.agent.aftersales_instructions}` : "",
    `# PACKAGE KNOWLEDGE (active versions)\n` + i.agentDocs.map((d) => `## ${d.section} (v${d.version})\n${d.content.trim()}`).join("\n\n"),
    i.itinerarySummary ? `# ITINERARY BY DAY\n${i.itinerarySummary}` : "",
  ].filter(Boolean).join("\n\n");

  const system: TextBlockParam[] = [
    { type: "text", text: RULES },
    { type: "text", text: companyBlock, cache_control: { type: "ephemeral" } },
    { type: "text", text: agentBlock, cache_control: { type: "ephemeral" } },
  ];

  const messages = transcriptToMessages(i.transcript);
  if (i.extraUserInstruction) messages.push({ role: "user", content: i.extraUserInstruction });
  if (!messages.length || messages.at(-1)!.role !== "user") messages.push({ role: "user", content: "(No new customer message.)" });

  const c = i.context;
  const ctx = [
    "CONTEXT FOR THIS TURN (from MTB systems, not written by the customer):",
    `Now (Malaysia time): ${c.now}`,
    `Customer: ${c.customerName ?? "unknown name"} · WhatsApp +${c.customerPhone}`,
    `Stage: ${c.stage}${c.tripDate ? ` · trip date ${c.tripDate}` : ""}`,
    c.booking ? `BOOKING: ${c.booking}` : "",
    c.labels.length ? `Labels: ${c.labels.join(", ")}` : "",
    Object.keys(c.keyDetails).length ? `Known details: ${JSON.stringify(c.keyDetails)}` : "",
    c.previousSummary ? `Previous summary: ${c.previousSummary}` : "",
    `Your messages are shown to the customer as "Pembantu AI · ${c.staffName}". ${c.staffName} is the staff member responsible for this chat.`,
    i.officialAnswers.length ? `OFFICIAL ANSWERS that may apply (they override knowledge):\n${i.officialAnswers.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`).join("\n")}` : "No official answer matched this turn; use get_official_answer if the customer asks a policy question.",
  ].filter(Boolean).join("\n");
  messages.push({ role: "system", content: ctx } as MessageParam);
  return { system, messages };
}

/** Last 30 messages → alternating user/assistant turns (notes, events and tool lines are left out). */
export function transcriptToMessages(t: TranscriptMessage[]): MessageParam[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of t.slice(-30)) {
    if (["note", "event", "tool"].includes(m.type)) continue;
    const role = m.direction === "in" ? "user" : "assistant";
    let text = (m.body ?? "").replace(/^\*[^*\n]+\*\n/, "");
    if (m.direction === "in" && !text) text = `[${m.type}]`;
    else if (m.direction === "in" && ["image", "document", "audio", "video"].includes(m.type)) text = `[${m.type}] ${text}`;
    if (m.sender_type === "staff") text = `[Staff ${m.staff_name ?? ""}] ${text}`;
    if (m.type === "template") text = `[Template sent] ${text}`;
    if (!text.trim()) continue;
    const last = out.at(-1);
    if (last && last.role === role) last.text += `\n${text}`;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, content: m.text }));
}

export function splitReplies(text: string, max = 4): string[] {
  const parts = text.split(/\n\s*-{3,}\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n\n")];
}
