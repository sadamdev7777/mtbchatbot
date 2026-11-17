// Pure business rules from the brief (section 5, 7, 9). Covered by Deno and Vitest tests.

export const MAX_ROWS = 8;

/** Rule 10: honest identity prefixes. */
export function aiPrefix(staffName: string): string {
  return `*Pembantu AI · ${staffName}*`;
}
export function staffPrefix(staffName: string): string {
  return `*${staffName}*`;
}
export function withPrefix(prefix: string, body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith(prefix)) return trimmed;
  return `${prefix}\n${trimmed}`;
}

/** Rule 9: any list sent to or by the AI is capped at 8 rows. */
export function capRows<T>(rows: T[], max = MAX_ROWS): T[] {
  return rows.slice(0, max);
}

/** Indonesian words and other banned phrases from the MTB language style. */
export const INDONESIAN_WORDS = ["silakan", "bisa", "dapat", "sangat", "bapak", "ibu"];
export const WEATHER_WORDS = ["musim hujan", "hujan", "monsun", "musim tengkujuh", "cuaca buruk", "rainy season"];

export function findBannedWords(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => new RegExp(`(^|[^\\p{L}])${escapeRegex(w.toLowerCase())}([^\\p{L}]|$)`, "u").test(lower));
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rule 13: opt-out keywords and buttons. */
export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  return t === "stop" || t === "berhenti" || t === "jangan hantar lagi" || t === "unsubscribe";
}

/** Customer asks for a person. */
export function asksForHuman(text: string): boolean {
  return /\b(nak|mahu|boleh)?\s*(cakap|bercakap|chat|sembang)?\s*(dengan)?\s*(staf|staff|orang|manusia|admin|agent|ejen|human|cs)\b/i.test(text) &&
    /(staf|staff|orang|manusia|admin|agent|ejen|human|\bcs\b)/i.test(text);
}

/** Customer asks whether this is a bot. */
export function asksIfBot(text: string): boolean {
  return /\b(bot|robot|ai|auto ?reply|mesin)\b/i.test(text) && /(ke|kah|ka|ni|is this|\?)/i.test(text);
}

export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = "6" + d; // Malaysian local format 01x → 601x
  return d;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export interface RoutingRule {
  id: string;
  priority: number;
  type: "ad" | "keyword" | "ask" | "fallback";
  match: Record<string, unknown>;
  target_agent_id: string | null;
  target_team_id: string | null;
  enabled: boolean;
}

export type RouteDecision =
  | { kind: "agent"; agentId: string; ruleId: string; via: "ad" | "keyword" | "classifier" | "ask" }
  | { kind: "team"; teamId: string; ruleId: string; via: "ad" | "keyword" | "ask" | "fallback" | "classifier" }
  | { kind: "ask"; ruleId: string; text: string; buttons: { id: string; title: string }[] }
  | { kind: "none" };

export function matchKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k.toLowerCase())}([^\\p{L}\\p{N}]|$)`, "u").test(lower));
}

/**
 * Deterministic router: ad referral → keywords → (caller may classify) → ask → fallback.
 * `allowAsk` is false once the customer has already been asked.
 */
export function routeFirstMessage(
  rules: RoutingRule[],
  input: { text: string; referralSourceId?: string | null; buttonId?: string | null; allowAsk: boolean; skipKeywords?: boolean },
): RouteDecision {
  const sorted = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  const target = (r: RoutingRule, via: "ad" | "keyword" | "fallback" | "ask"): RouteDecision | null => {
    if (r.target_agent_id) return { kind: "agent", agentId: r.target_agent_id, ruleId: r.id, via: via === "fallback" ? "keyword" : via } as RouteDecision;
    if (r.target_team_id) return { kind: "team", teamId: r.target_team_id, ruleId: r.id, via };
    return null;
  };
  if (input.buttonId) {
    for (const r of sorted.filter((r) => r.type === "ask")) {
      const answers = (r.match.answers ?? {}) as Record<string, { agent?: string; team?: string }>;
      const a = answers[input.buttonId];
      if (a?.agent) return { kind: "agent", agentId: a.agent, ruleId: r.id, via: "ask" };
      if (a?.team) return { kind: "team", teamId: a.team, ruleId: r.id, via: "ask" };
    }
  }
  if (input.referralSourceId) {
    for (const r of sorted.filter((r) => r.type === "ad")) {
      const ids = (r.match.source_ids ?? []) as string[];
      if (ids.includes(input.referralSourceId)) {
        const t = target(r, "ad");
        if (t) return t;
      }
    }
  }
  if (!input.skipKeywords) {
    for (const r of sorted.filter((r) => r.type === "keyword")) {
      if (matchKeyword(input.text, (r.match.keywords ?? []) as string[])) {
        const t = target(r, "keyword");
        if (t) return t;
      }
    }
  }
  if (input.allowAsk) {
    const ask = sorted.find((r) => r.type === "ask");
    if (ask) {
      return {
        kind: "ask",
        ruleId: ask.id,
        text: String(ask.match.text ?? "Assalamualaikum! Cik berminat destinasi mana?"),
        buttons: (ask.match.buttons ?? []) as { id: string; title: string }[],
      };
    }
  }
  const fb = sorted.find((r) => r.type === "fallback");
  if (fb) {
    const t = target(fb, "fallback");
    if (t) return t;
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Agent work mode
// ---------------------------------------------------------------------------
export type AgentMode = "follow_schedule" | "auto" | "assist" | "off";
export type EffectiveMode = "auto" | "assist" | "off";

export function effectiveMode(mode: AgentMode, inOfficeHours: boolean, opts: { spendCapReached?: boolean; claudeConnected?: boolean } = {}): EffectiveMode {
  if (opts.claudeConnected === false) return "off";
  if (mode === "off") return "off";
  let m: EffectiveMode = mode === "follow_schedule" ? (inOfficeHours ? "assist" : "auto") : mode;
  if (opts.spendCapReached && m === "auto") m = "assist";
  return m;
}

export type AgentStageMode = "close_sale" | "after_sales" | "none";
export function stageMode(stage: string): AgentStageMode {
  if (stage === "lead" || stage === "booking") return "close_sale";
  if (stage === "deposit" || stage === "full_payment") return "after_sales";
  return "none";
}

// ---------------------------------------------------------------------------
// Payment auto-verify (section 9)
// ---------------------------------------------------------------------------
export interface ReceiptFacts {
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  reference: string | null;
  sender: string | null;
  editedSuspect: boolean;
}
export interface BankEmailFacts {
  amount: number | null;
  date: string | null;
  reference: string | null;
  senderName: string | null;
  fromAddress: string;
}
export interface AutoVerifyResult {
  ok: boolean;
  checks: { amount: boolean; date: boolean; reference_or_name: boolean; trusted_sender: boolean; not_edited: boolean };
  reasons: string[];
}

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\b(bin|binti|bt|bte|a\/l|a\/p|puan|encik|cik|tuan)\b/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

export function autoVerify(
  invoice: { amount: number; bookingRef: string; leadGuestName: string | null },
  receipt: ReceiptFacts,
  email: BankEmailFacts,
  trustedSenders: string[],
): AutoVerifyResult {
  const reasons: string[] = [];
  const amount = email.amount !== null && Math.abs(email.amount - invoice.amount) < 0.005 &&
    (receipt.amount === null || Math.abs(receipt.amount - invoice.amount) < 0.005);
  if (!amount) reasons.push(`Amount mismatch: invoice RM${invoice.amount.toFixed(2)}, bank RM${email.amount ?? "?"}, receipt RM${receipt.amount ?? "?"}`);
  let date = false;
  if (email.date && receipt.date) {
    const diff = Math.abs(Date.parse(email.date) - Date.parse(receipt.date)) / 86400000;
    date = diff <= 3;
  }
  if (!date) reasons.push("Bank email date is not within 3 days of the receipt");
  const ref = (email.reference ?? "").toUpperCase().replace(/\s/g, "");
  const refOk = !!invoice.bookingRef && ref.includes(invoice.bookingRef.toUpperCase().replace(/\s/g, ""));
  const nameOk = !!invoice.leadGuestName && !!email.senderName && normName(email.senderName) === normName(invoice.leadGuestName);
  const reference_or_name = refOk || nameOk;
  if (!reference_or_name) reasons.push("Reference does not contain the booking number and sender name does not match the lead guest");
  const trusted_sender = trustedSenders.map((s) => s.toLowerCase().trim()).includes(email.fromAddress.toLowerCase().trim());
  if (!trusted_sender) reasons.push(`Email sender ${email.fromAddress} is not a trusted address`);
  const not_edited = !receipt.editedSuspect;
  if (!not_edited) reasons.push("Receipt looks edited");
  return {
    ok: amount && date && reference_or_name && trusted_sender && not_edited,
    checks: { amount, date, reference_or_name, trusted_sender, not_edited },
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Follow-up stop rules (7.6)
// ---------------------------------------------------------------------------
export interface FollowupContext {
  customerRepliedSinceScheduled: boolean;
  notInterested: boolean;
  templatesSent: number;
  maxTemplates: number;
  isTemplateStep: boolean;
  holderType: "ai" | "staff" | "none";
  quietHours: boolean;
  optedOut: boolean;
  isMarketing: boolean;
  windowOpen: boolean;
  isFreeStep: boolean;
}
export type FollowupVerdict = "send" | "wait_quiet" | "cancel_replied" | "cancel_not_interested" | "cancel_template_cap" |
  "remind_staff" | "cancel_opted_out" | "skip_window_closed";

export function followupVerdict(c: FollowupContext): FollowupVerdict {
  if (c.customerRepliedSinceScheduled) return "cancel_replied";
  if (c.notInterested) return "cancel_not_interested";
  if (c.optedOut && (c.isMarketing || c.isFreeStep)) return "cancel_opted_out";
  if (c.isTemplateStep && c.templatesSent >= c.maxTemplates) return "cancel_template_cap";
  if (c.holderType === "staff") return "remind_staff";
  if (c.isFreeStep && !c.windowOpen) return "skip_window_closed";
  if (c.quietHours) return "wait_quiet";
  return "send";
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------
// USD per million tokens (Anthropic first-party list prices, Nov 2026). Cache writes are 1.25x input
// (5-minute TTL). Override per company via settings.model_prices.
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export function runCostUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES["claude-sonnet-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
}

/** Temperature decay: HOT becomes WARM after 7 quiet days. */
export function decayTemperature(current: "HOT" | "WARM" | "COLD", lastInboundAt: Date | null, now: Date): "HOT" | "WARM" | "COLD" {
  if (current === "HOT" && lastInboundAt && now.getTime() - lastInboundAt.getTime() >= 7 * 86400000) return "WARM";
  return current;
}
