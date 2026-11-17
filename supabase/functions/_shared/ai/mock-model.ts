// Deterministic stand-in for Claude used when the Claude integration is not connected and
// MOCK_PROVIDERS=true. It follows the same tool protocol as the real model so the orchestrator,
// tools, drafts, test bot and e2e tests exercise the real code paths.
import { asksForHuman, asksIfBot, findBannedWords, INDONESIAN_WORDS, MAX_ROWS } from "../core/rules.ts";
import { dayMonthMs, monthLabelMs, parseMonth, parsePax, unrelatedTopic } from "../core/nlp.ts";
import type { ContentBlock, MessageParam, ModelCall, ModelResult } from "./model.ts";

let seq = 0;
const id = () => `toolu_mock_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function textBlocks(c: MessageParam["content"] | undefined): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  return c.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

function result(content: ContentBlock[], stop = "end_turn"): ModelResult {
  const chars = JSON.stringify(content).length;
  return { content, stopReason: stop, usage: { input: 0, output: Math.ceil(chars / 4), cacheRead: 0, cacheWrite: 0 }, model: "mock-model", costUsd: 0 };
}
const say = (t: string) => result([{ type: "text", text: t, citations: null } as unknown as ContentBlock]);
const use = (name: string, input: Record<string, unknown>, preface?: string) => result([
  ...(preface ? [{ type: "text", text: preface, citations: null } as unknown as ContentBlock] : []),
  { type: "tool_use", id: id(), name, input } as unknown as ContentBlock,
], "tool_use");

/** Customer text of the latest user turn (excluding tool results and context blocks). */
function customerTurn(messages: MessageParam[]): { latest: string; all: string; history: string[] } {
  const users = messages.filter((m) => m.role === "user").map((m) => textBlocks(m.content));
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return { latest: lastUser ? textBlocks(lastUser.content) : "", all: users.join("\n"), history: users };
}

function systemText(c: ModelCall): string {
  return c.system.map((b) => b.text).join("\n") + "\n" + c.messages.filter((m) => (m.role as string) === "system").map((m) => textBlocks(m.content)).join("\n");
}

function greet(text: string): string {
  return /assalamualaikum|salam/i.test(text) ? "Waalaikumussalam cik 😊\n" : "";
}

function agent(c: ModelCall): ModelResult {
  const last = c.messages.filter((m) => (m.role as string) !== "system").at(-1)!;
  const sys = systemText(c);
  const destination = sys.match(/DESTINATION:\s*(.+)/)?.[1]?.trim() ?? "";
  const afterSales = /MODE:\s*after_sales/.test(sys);

  // 1) Follow-up on tool results
  if (last.role === "user" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) {
    const prevAssistant = [...c.messages].reverse().find((m) => m.role === "assistant");
    const uses = Array.isArray(prevAssistant?.content) ? prevAssistant!.content.filter((b) => b.type === "tool_use") as { name: string; id: string; input: any }[] : [];
    const results = new Map((last.content as any[]).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, typeof b.content === "string" ? b.content : JSON.stringify(b.content)]));
    const u = uses[0];
    const raw = results.get(u?.id) ?? "{}";
    let r: any = {};
    try { r = JSON.parse(raw); } catch { r = { text: raw }; }
    const { all } = customerTurn(c.messages.filter((m) => !(Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"))));
    switch (u?.name) {
      case "search_products": {
        const rows = (r.rows ?? []) as { start_date: string; end_date: string; price_adult: number; available: number; group_id: string }[];
        const pax = Number(u.input.pax ?? 1);
        if (!rows.length) return say(`Maaf cik, tiada tarikh untuk ${u.input.month ? monthLabelMs(u.input.month) : "bulan itu"}. Cik mahu saya semak bulan lain?`);
        const lines = rows.slice(0, MAX_ROWS).map((x) => `• ${dayMonthMs(x.start_date)} – ${dayMonthMs(x.end_date)} · RM${x.price_adult.toLocaleString("en-MY")} · ${x.available} seat`).join("\n");
        const head = `${greet(all.split("\n")[0])}${u.input.month ? `Untuk ${monthLabelMs(u.input.month)}, ` : ""}${pax} orang:`;
        if ((r.exact_matches ?? 0) === 0) {
          return say(`${head}\n${lines}\n---\nSeat pada tarikh ini kurang daripada ${pax}. Saya boleh minta staf semak tambahan seat untuk cik. Cik mahu saya teruskan?`);
        }
        return say(`${head}\n${lines}\n---\nCik nak saya kunci seat untuk tarikh mana?`);
      }
      case "get_official_answer":
        if (r.found) return say(`${r.answer}\n---\nAda apa-apa lagi sebelum saya semak tarikh untuk cik?`);
        return use("handover_to_staff", { reason: "Question not covered by knowledge or an official answer", summary: `Customer asked: ${all.split("\n").at(-1)}` });
      case "handover_to_staff":
        return say("Baik cik, saya minta staf kami sambung dalam chat ini. Staf akan balas secepat mungkin hari ini. Ada apa-apa yang cik mahu saya catat untuk staf?");
      case "create_seat_lock_link":
        if (r.error) return use("handover_to_staff", { reason: `Seat lock failed: ${r.error}`, summary: "Customer ready to book; lock link could not be created" });
        return say(`Ini pautan untuk kunci seat (dipegang 24 jam):\n${r.url}\n---\nSelepas seat dikunci, staf kami akan hantar pautan bayaran deposit. Ada soalan lain sebelum cik isi borang?`);
      case "get_package_info":
        return say(`Pakej ${r.name ?? ""} termasuk: ${(r.inclusions ?? []).join(", ")}.\n---\nTidak termasuk: ${(r.exclusions ?? []).join(", ")}. Cik mahu saya semak tarikh?`);
      case "get_booking":
      case "check_payment":
        if (!r || r.error || r.found === false) return use("handover_to_staff", { reason: "Booking not found", summary: "Customer asked about a booking we could not find" });
        return say(`Tempahan ${r.id ?? r.booking_id}: dibayar RM${r.paid}, baki RM${r.balance}${r.balance_due ? `, perlu dijelaskan sebelum ${r.balance_due}` : ""}.\n---\nAda apa-apa lagi yang saya boleh bantu tentang tempahan cik?`);
      default:
        return say("Baik cik. Ada apa-apa lagi yang saya boleh bantu tentang pakej MTB?");
    }
  }

  // 2) Fresh customer turn
  const { latest, all } = customerTurn(c.messages);
  if (asksIfBot(latest)) return say("Ya cik, saya pembantu AI Muslimtravelbug. Saya boleh bantu semak tarikh dan harga, atau panggilkan staf kami. Cik mahu bercakap dengan staf?");
  if (asksForHuman(latest)) return use("handover_to_staff", { reason: "Customer asked for a staff member", summary: `Customer asked for a person. Last message: ${latest}` });
  if (unrelatedTopic(latest)) return say("Maaf cik, saya hanya boleh bantu tentang pakej dan tempahan Muslimtravelbug. Cik berminat destinasi mana?");
  if (/(flight|tiket kapal terbang|penerbangan|alor setar|klia|airasia|mas\b)/i.test(latest)) {
    return use("handover_to_staff", { reason: "Question not in knowledge (flight booking)", summary: `Customer asked about flights: ${latest}` });
  }
  if (/(komplen|complain|kecewa|marah|tak puas hati|refund|bayaran.*(gagal|masalah))/i.test(latest)) {
    return use("handover_to_staff", { reason: "Complaint or payment issue", summary: latest });
  }
  if (/(tetap nak|walaupun|nak juga|tambah\s*\d+|boleh tambah)/i.test(latest)) {
    return use("handover_to_staff", { reason: "Seats not enough and the customer insists: request extra seats", summary: latest });
  }
  if (/(halal|ansuran|installment|gunung|daki|bayar bulan)/i.test(latest)) return use("get_official_answer", { question: latest });
  if (afterSales) {
    const ref = latest.match(/MTB-\d+/)?.[0] ?? sys.match(/BOOKING:\s*(MTB-\d+)/)?.[1];
    if (/(baki|bayar|balance|payment|resit|deposit)/i.test(latest) && ref) return use("check_payment", { booking_ref: ref });
    if (/(itinerari|itinerary|jadual|tentatif)/i.test(latest)) return use("send_itinerary_pdf", { product_id: sys.match(/PRODUCT_IDS:\s*([^\s,]+)/)?.[1] ?? "" });
  }
  const ic = latest.match(/\b\d{6}-?\d{2}-?\d{4}\b/);
  const email = latest.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (ic || email) {
    const group = [...JSON.stringify(c.messages).matchAll(/"group_id":"([^"]+)"/g)].map((m) => m[1])[0];
    const name = latest.split(/[,\n]/)[0].replace(/nama\s*:?/i, "").trim();
    const pax = parsePax(all)?.total ?? 1;
    if (group) return use("create_seat_lock_link", { group_id: group, pax, lead_name: name || "Ketua rombongan", lead_email: email?.[0] ?? null });
  }
  if (/(kunci|lock|nak book|nak tempah|saya ambil|setuju)/i.test(latest)) {
    return say("Baik cik. Untuk kunci seat, saya perlukan nama penuh ketua rombongan, No. IC dan emel. Boleh cik kongsikan?");
  }
  const month = parseMonth(latest) ?? parseMonth(all.split("\n").reverse().join("\n"));
  const pax = parsePax(latest) ?? parsePax(all);
  if (!month) return say(`${greet(latest)}Boleh cik kongsikan bulan yang dirancang dan berapa orang? Saya semak tarikh dan seat terkini untuk satu bulan pada satu masa.`);
  if (!pax) return say(`${greet(latest)}Untuk ${monthLabelMs(month)}, berapa orang yang akan pergi (dewasa dan kanak-kanak)?`);
  return use("search_products", { destination, month, pax: pax.total });
}

function judge(c: ModelCall): ModelResult {
  // Deterministic checks do the real grading; the mock judge passes unless banned words appear.
  const transcript = c.messages.map((m) => textBlocks(m.content)).join("\n");
  const bad = findBannedWords(transcript.split("BOT REPLY:").slice(1).join("\n"), [...INDONESIAN_WORDS, "anda"]);
  return say(JSON.stringify({ pass: bad.length === 0, reason: bad.length ? `Uses ${bad.join(", ")}` : "Mock judge: rubric not evaluated, deterministic checks apply" }));
}

export function mockModelCall(c: ModelCall): ModelResult {
  const last = c.messages.at(-1);
  const lastText = last ? textBlocks(last.content) : "";
  switch (c.purpose) {
    case "agent":
    case "followup":
      if (c.purpose === "followup" || /FOLLOW-UP TASK/.test(lastText)) {
        const hint = lastText.match(/HINT:\s*(.+)/)?.[1] ?? "";
        return say(`Assalamualaikum cik. ${hint.includes("pax") ? "Boleh saya tahu berapa orang yang akan pergi supaya saya boleh semak seat?" : "Masih berminat dengan pakej ini? Seat terhad, saya boleh semak tarikh terkini untuk cik."}`);
      }
      return agent(c);
    case "router":
      return say(JSON.stringify({ agent_key: "unclear" }));
    case "summary": {
      const t = c.messages.map((m) => textBlocks(m.content)).join(" ");
      const month = parseMonth(t), pax = parsePax(t);
      return say(`Customer is asking about ${month ? monthLabelMs(month) : "a package"}${pax ? ` for ${pax.total} pax` : ""}. ${/kunci|lock|tempah/i.test(t) ? "Wants to book." : "Has not asked to book yet."}`);
    }
    case "rewrite": {
      const src = lastText.split("DRAFT:\n")[1] ?? lastText;
      const sentences = src.split(/(?<=[.?!])\s+/);
      return say(sentences.length > 2 ? `${sentences[0]} ${sentences.at(-1)}` : src);
    }
    case "judge":
      return judge(c);
    default:
      return say("{}");
  }
}
