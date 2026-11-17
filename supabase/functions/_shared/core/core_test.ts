import { assert, assertEquals } from "@std/assert";
import {
  aiPrefix, asksForHuman, asksIfBot, autoVerify, capRows, decayTemperature, effectiveMode, findBannedWords,
  followupVerdict, INDONESIAN_WORDS, isOptOut, normalizePhone, routeFirstMessage, runCostUsd, stageMode, withPrefix,
  type FollowupContext, type RoutingRule,
} from "./rules.ts";
import { isQuietHours, isWindowOpen, isWithinOfficeHours, nextAllowedSendTime, windowRemainingMs } from "./time.ts";

// Malaysia is UTC+8: 2026-11-17 (Tue) 10:00 MYT = 02:00Z
const myt = (iso: string) => new Date(iso + "+08:00");

Deno.test("24-hour window", () => {
  const now = myt("2026-11-17T10:00:00");
  assert(isWindowOpen(myt("2026-11-16T10:00:01"), now));
  assert(!isWindowOpen(myt("2026-11-16T09:59:59"), now));
  assert(!isWindowOpen(null, now));
  assertEquals(windowRemainingMs(myt("2026-11-17T09:00:00"), now), 23 * 3600 * 1000);
});

Deno.test("quiet hours 22:00–08:00 and Friday prayers", () => {
  assert(isQuietHours(myt("2026-11-17T22:00:00")));
  assert(isQuietHours(myt("2026-11-17T07:59:00")));
  assert(!isQuietHours(myt("2026-11-17T08:00:00")));
  assert(!isQuietHours(myt("2026-11-17T13:00:00"))); // Tuesday lunchtime is fine
  assert(isQuietHours(myt("2026-11-20T13:00:00"))); // Friday 13:00
  assert(!isQuietHours(myt("2026-11-20T14:30:00")));
  assertEquals(nextAllowedSendTime(myt("2026-11-17T23:10:00")).toISOString(), myt("2026-11-18T08:00:00").toISOString());
  assertEquals(nextAllowedSendTime(myt("2026-11-20T12:45:00")).toISOString(), myt("2026-11-20T14:30:00").toISOString());
});

Deno.test("office hours: Mon–Fri 9–18, Sat 9–13", () => {
  assert(isWithinOfficeHours(myt("2026-11-17T09:00:00")));
  assert(!isWithinOfficeHours(myt("2026-11-17T18:00:00")));
  assert(isWithinOfficeHours(myt("2026-11-21T12:59:00"))); // Saturday
  assert(!isWithinOfficeHours(myt("2026-11-21T13:00:00")));
  assert(!isWithinOfficeHours(myt("2026-11-22T10:00:00"))); // Sunday
});

Deno.test("work mode resolution", () => {
  assertEquals(effectiveMode("follow_schedule", true), "assist");
  assertEquals(effectiveMode("follow_schedule", false), "auto");
  assertEquals(effectiveMode("auto", true, { spendCapReached: true }), "assist");
  assertEquals(effectiveMode("auto", true, { claudeConnected: false }), "off");
  assertEquals(stageMode("booking"), "close_sale");
  assertEquals(stageMode("full_payment"), "after_sales");
});

Deno.test("identity prefixes", () => {
  assertEquals(aiPrefix("Farah"), "*Pembantu AI · Farah*");
  assertEquals(withPrefix("*Farah*", "Baik cik"), "*Farah*\nBaik cik");
  assertEquals(withPrefix("*Farah*", "*Farah*\nBaik cik"), "*Farah*\nBaik cik");
});

Deno.test("max 8 rows", () => {
  assertEquals(capRows(Array.from({ length: 53 }, (_, i) => i)).length, 8);
});

Deno.test("banned words are matched as whole words", () => {
  assertEquals(findBannedWords("Silakan pilih tarikh", INDONESIAN_WORDS), ["silakan"]);
  assertEquals(findBannedWords("Boleh dapatkan dokumen", INDONESIAN_WORDS), []); // "dapatkan" is Malay
  assertEquals(findBannedWords("Kami dapat bantu", INDONESIAN_WORDS), ["dapat"]);
});

Deno.test("intent helpers", () => {
  assert(isOptOut("STOP"));
  assert(isOptOut("Jangan hantar lagi"));
  assert(!isOptOut("stop dulu saya fikir"));
  assert(asksForHuman("nak cakap dengan staf"));
  assert(asksForHuman("boleh saya chat dengan orang?"));
  assert(!asksForHuman("berapa harga"));
  assert(asksIfBot("ni bot ke?"));
  assertEquals(normalizePhone("012-345 6789"), "60123456789");
  assertEquals(normalizePhone("+60 12 345 6789"), "60123456789");
});

const rules: RoutingRule[] = [
  { id: "ad", priority: 10, type: "ad", match: { source_ids: ["AD1"] }, target_agent_id: "nura", target_team_id: null, enabled: true },
  { id: "kw", priority: 20, type: "keyword", match: { keywords: ["kundasang", "kk"] }, target_agent_id: "nura", target_team_id: null, enabled: true },
  { id: "kw2", priority: 21, type: "keyword", match: { keywords: ["turki"] }, target_agent_id: null, target_team_id: "overseas", enabled: true },
  { id: "ask", priority: 30, type: "ask", match: { text: "Destinasi?", buttons: [{ id: "dest_sabah", title: "Sabah" }], answers: { dest_sabah: { team: "sabah" } } }, target_agent_id: null, target_team_id: null, enabled: true },
  { id: "fb", priority: 99, type: "fallback", match: {}, target_agent_id: null, target_team_id: "general", enabled: true },
];

Deno.test("router order: ad → keyword → ask → fallback", () => {
  assertEquals(routeFirstMessage(rules, { text: "hi", referralSourceId: "AD1", allowAsk: true }).kind, "agent");
  const kw = routeFirstMessage(rules, { text: "Pakej Kundasang Mac?", allowAsk: true });
  assertEquals(kw.kind === "agent" && kw.agentId, "nura");
  assertEquals(routeFirstMessage(rules, { text: "kkkk", allowAsk: true }).kind, "ask"); // whole word only
  const team = routeFirstMessage(rules, { text: "ada pakej Turki?", allowAsk: true });
  assertEquals(team.kind === "team" && team.teamId, "overseas");
  const asked = routeFirstMessage(rules, { text: "Sabah", buttonId: "dest_sabah", allowAsk: false });
  assertEquals(asked.kind === "team" && asked.teamId, "sabah");
  const fb = routeFirstMessage(rules, { text: "hello", allowAsk: false });
  assertEquals(fb.kind === "team" && fb.teamId, "general");
});

Deno.test("payment auto-verify needs every condition", () => {
  const inv = { amount: 600, bookingRef: "MTB-10234", leadGuestName: "Aminah binti Yusof" };
  const rc = { amount: 600, date: "2026-11-15", reference: "MTB-10234", sender: "AMINAH YUSOF", editedSuspect: false };
  const em = { amount: 600, date: "2026-11-16", reference: "deposit MTB-10234", senderName: "AMINAH BINTI YUSOF", fromAddress: "alerts@maybank.com.my" };
  assert(autoVerify(inv, rc, em, ["alerts@maybank.com.my"]).ok);
  assert(!autoVerify(inv, rc, { ...em, amount: 599 }, ["alerts@maybank.com.my"]).ok);
  assert(!autoVerify(inv, rc, { ...em, date: "2026-11-20" }, ["alerts@maybank.com.my"]).ok);
  assert(autoVerify(inv, rc, { ...em, reference: "transfer" }, ["alerts@maybank.com.my"]).ok); // name match is enough
  assert(!autoVerify(inv, rc, { ...em, reference: "transfer", senderName: "ALI" }, ["alerts@maybank.com.my"]).ok);
  assert(!autoVerify(inv, rc, { ...em, fromAddress: "fake@gmail.com" }, ["alerts@maybank.com.my"]).ok);
  assert(!autoVerify(inv, { ...rc, editedSuspect: true }, em, ["alerts@maybank.com.my"]).ok);
});

Deno.test("follow-up stop rules", () => {
  const base: FollowupContext = {
    customerRepliedSinceScheduled: false, notInterested: false, templatesSent: 0, maxTemplates: 2, isTemplateStep: false,
    holderType: "ai", quietHours: false, optedOut: false, isMarketing: false, windowOpen: true, isFreeStep: true,
  };
  assertEquals(followupVerdict(base), "send");
  assertEquals(followupVerdict({ ...base, customerRepliedSinceScheduled: true }), "cancel_replied");
  assertEquals(followupVerdict({ ...base, holderType: "staff" }), "remind_staff");
  assertEquals(followupVerdict({ ...base, quietHours: true }), "wait_quiet");
  assertEquals(followupVerdict({ ...base, isFreeStep: false, isTemplateStep: true, templatesSent: 2 }), "cancel_template_cap");
  assertEquals(followupVerdict({ ...base, optedOut: true }), "cancel_opted_out");
  assertEquals(followupVerdict({ ...base, windowOpen: false }), "skip_window_closed");
});

Deno.test("cost and temperature decay", () => {
  assertEquals(runCostUsd("claude-sonnet-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 2);
  const now = new Date("2026-11-17T00:00:00Z");
  assertEquals(decayTemperature("HOT", new Date("2026-11-09T00:00:00Z"), now), "WARM");
  assertEquals(decayTemperature("HOT", new Date("2026-11-12T00:00:00Z"), now), "HOT");
});
