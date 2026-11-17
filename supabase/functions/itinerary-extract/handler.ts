// Itinerary upload (7.5): extract days/inclusions/questions with Claude (PDF, image or Word), batch
// questions for staff, and activate only when every question is answered and scenarios pass.
// Also: agent-wizard helpers (generate test scenarios, import past chats as official-answer drafts).
import JSZip from "jszip";
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { addClaudeSpend, modelName } from "../_shared/ai/orchestrator.ts";
import { jsonOf, modelFor, type ModelCall } from "../_shared/ai/model.ts";
import { runAllScenarios } from "../_shared/ai/scenarios.ts";
import { travelBoostFor } from "../_shared/providers/travelboost.ts";

export interface Extracted {
  days: { day: number; route: string; activities: string[]; meals: string[]; hotel: string | null }[];
  included: string[]; not_included: string[]; free_and_easy: string[];
  questions: { question: string; why: string; options: string[] }[];
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["days", "included", "not_included", "free_and_easy", "questions"],
  properties: {
    days: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "route", "activities", "meals", "hotel"], properties: {
      day: { type: "integer" }, route: { type: "string" }, activities: { type: "array", items: { type: "string" } }, meals: { type: "array", items: { type: "string" } }, hotel: { type: ["string", "null"] } } } },
    included: { type: "array", items: { type: "string" } }, not_included: { type: "array", items: { type: "string" } }, free_and_easy: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "why", "options"], properties: {
      question: { type: "string" }, why: { type: "string" }, options: { type: "array", items: { type: "string" } } } } },
  },
} as const;

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function docxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string") ?? "";
  return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}

/** Mock extraction: built from the TravelBoost product, with two typical ambiguity questions. */
async function mockExtract(companyId: string, productId: string): Promise<Extracted> {
  const p = await (await travelBoostFor(companyId)).getProduct(productId);
  return {
    days: (p?.itinerary ?? [{ day: 1, title: "Hari 1", activities: [] }]).map((d) => ({ day: d.day, route: d.title, activities: d.activities, meals: ["Sarapan", "Makan tengah hari", "Makan malam"], hotel: p?.hotels[Math.min(d.day - 1, (p?.hotels.length ?? 1) - 1)] ?? null })),
    included: p?.inclusions ?? [], not_included: p?.exclusions ?? [], free_and_easy: [],
    questions: [
      { question: "Is breakfast included on the last day?", why: "Day 4 lists check-out at 10:00 but no meals.", options: ["Yes, hotel breakfast", "No meals on the last day"] },
      { question: "Is the Desa Dairy Farm entrance ticket included for children under 3?", why: "The file says 'tickets included' without age rules.", options: ["Included for all ages", "Free under 3", "Paid separately"] },
    ],
  };
}

async function extract(itineraryId: string): Promise<void> {
  const { data: it } = await db().from("itineraries").select("*, agent:agents(name), company:companies(settings)").eq("id", itineraryId).single();
  if (!it) throw new HttpError(404, "not_found");
  await db().from("itineraries").update({ status: "extracting", error_text: null }).eq("id", it.id);
  try {
    const model = await modelFor(it.company_id);
    let ex: Extracted | null;
    if (!model) throw new Error("Claude is not connected: itinerary extraction needs the Claude API");
    if (model.mode === "mock") ex = await mockExtract(it.company_id, it.travelboost_product_id);
    else {
      const { data: file } = await db().storage.from("media").download(it.file_path);
      if (!file) throw new Error("File not found in storage");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || "application/octet-stream";
      const name = String(it.file_name ?? "").toLowerCase();
      const content: any[] = [];
      if (mime === "application/pdf" || name.endsWith(".pdf")) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } });
      else if (mime.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: mime, data: b64(bytes) } });
      else if (name.endsWith(".docx")) content.push({ type: "text", text: `ITINERARY FILE (Word):\n${await docxText(bytes)}` });
      else content.push({ type: "text", text: new TextDecoder().decode(bytes) });
      content.push({ type: "text", text: `Extract this travel itinerary for "${it.agent?.name}" (TravelBoost product ${it.travelboost_product_id}) into the JSON schema. Keep place names as written; write activities in Malay as in the file. Do NOT include prices or seat counts. List every ambiguity staff must confirm in "questions" (e.g. unclear meals, optional activities, age rules, hotel "or similar"), each with why it was flagged and 2–4 short answer options.` });
      const call: ModelCall = { purpose: "itinerary", model: modelName(it.company.settings, "chat"), maxTokens: 16000, effort: "medium",
        system: [{ type: "text", text: "You turn tour itineraries into structured data for a travel agency's AI assistant." }], messages: [{ role: "user", content }], jsonSchema: SCHEMA as unknown as Record<string, unknown> };
      const res = await model.call(call);
      await addClaudeSpend(it.company_id, res.costUsd);
      await db().from("ai_runs").insert({ company_id: it.company_id, agent_id: it.agent_id, purpose: "itinerary", model: res.model, input_tokens: res.usage.input, output_tokens: res.usage.output, cost: res.costUsd, decision: "none" });
      ex = jsonOf<Extracted>(res.content);
    }
    if (!ex) throw new Error("The model did not return the itinerary structure");
    await db().from("itinerary_questions").delete().eq("itinerary_id", it.id);
    if (ex.questions.length) {
      await db().from("itinerary_questions").insert(ex.questions.map((q) => ({ company_id: it.company_id, itinerary_id: it.id, question: q.question, why: q.why, options: q.options })));
    }
    await db().from("itineraries").update({ extracted: ex, status: ex.questions.length ? "needs_answers" : "ready" }).eq("id", it.id);
  } catch (e) {
    await db().from("itineraries").update({ status: "failed", error_text: (e as Error).message }).eq("id", it.id);
  }
}

export function itineraryMarkdown(ex: Extracted, answers: { question: string; answer: string }[], appliesTo: unknown, productId: string): string {
  return [
    `# Itinerary · ${productId} · ${appliesTo === "all" ? "all dates" : `dates: ${(appliesTo as string[]).join(", ")}`}`,
    ...ex.days.map((d) => `## Day ${d.day}: ${d.route}\n- ${d.activities.join("\n- ")}${d.meals.length ? `\n- Meals: ${d.meals.join(", ")}` : ""}${d.hotel ? `\n- Hotel: ${d.hotel}` : ""}`),
    ex.included.length ? `## Included\n- ${ex.included.join("\n- ")}` : "",
    ex.not_included.length ? `## Not included\n- ${ex.not_included.join("\n- ")}` : "",
    ex.free_and_easy.length ? `## Free & easy\n- ${ex.free_and_easy.join("\n- ")}` : "",
    answers.length ? `## Clarifications confirmed by staff\n${answers.map((a) => `- ${a.question} → ${a.answer}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

async function activate(itineraryId: string, memberId: string | null, force = false) {
  const { data: it } = await db().from("itineraries").select("*").eq("id", itineraryId).single();
  if (!it?.extracted) throw new HttpError(400, "not_ready", "Extraction has not finished");
  const { data: qs } = await db().from("itinerary_questions").select("question, answer").eq("itinerary_id", it.id);
  const open = (qs ?? []).filter((q) => !q.answer?.trim());
  if (open.length) throw new HttpError(409, "questions_open", `${open.length} question(s) still need an answer`);
  const section = `itinerary_${it.travelboost_product_id}`;
  const content = itineraryMarkdown(it.extracted as Extracted, (qs ?? []) as { question: string; answer: string }[], it.applies_to, it.travelboost_product_id);
  // run the agent's scenarios with the new itinerary first
  const run = await runAllScenarios(it.company_id, it.agent_id, { knowledge: "live", knowledge_override: [{ scope: "agent", section, content }], context: "itinerary_activation" });
  if (run.passed < run.total && !force) return { ok: false, error: "scenarios_failed", message: `${run.total - run.passed} scenario(s) failed; not activated`, run };
  const { data: v } = await db().from("knowledge_docs").select("version").eq("company_id", it.company_id).eq("scope", "agent").eq("agent_id", it.agent_id).eq("section", section).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: doc } = await db().from("knowledge_docs").insert({ company_id: it.company_id, scope: "agent", agent_id: it.agent_id, section, version: (v?.version ?? 0) + 1, status: "draft", content, source: "itinerary", created_by: memberId }).select("id").single();
  await db().rpc("activate_knowledge", { p_doc: doc!.id, p_member: memberId });
  await db().from("itineraries").update({ status: "archived" }).eq("agent_id", it.agent_id).eq("travelboost_product_id", it.travelboost_product_id).eq("status", "active").neq("id", it.id);
  await db().from("itineraries").update({ status: "active", knowledge_doc_id: doc!.id }).eq("id", it.id);
  return { ok: true, activated: true, scenarios: { passed: run.passed, total: run.total } };
}

// ---------------------------------------------------------------------------
// Wizard helpers
// ---------------------------------------------------------------------------
const MOCK_SCENARIOS = [
  ["Kids price", ["Berapa harga untuk kanak-kanak 5 tahun bulan Jun 2027? Kami 2 dewasa 1 budak"], "Gives child price from the tool for one month only and asks to book.", { ends_with_question: true }],
  ["Halal food", ["Makanan halal ke?"], "Uses the official answer: all food is halal.", { must_include_any: ["halal"] }],
  ["Price for 2 in July", ["Julai 2027 untuk 2 orang berapa?"], "Lists at most 8 July dates with prices and seats.", { max_rows: 8, ends_with_question: true }],
  ["Lock seat details", ["Ogos 2027 2 orang", "Saya ambil tarikh pertama. Nama Aminah binti Yusof, 850101-10-1234, aminah@example.com"], "Asks or uses the name, IC and email, then sends the seat-lock link.", {}],
  ["Talk to staff", ["Saya nak cakap dengan staf"], "Hands over politely.", { expect_handover: true }],
  ["Complaint", ["Saya kecewa, refund saya belum masuk lagi"], "Payment issue: hands over to staff.", { expect_handover: true }],
  ["Installment", ["Boleh bayar ansuran?"], "Uses the official answer about installments.", {}],
  ["Large group", ["Nak 12 orang bulan Mei 2027"], "Searches May only, never says full, offers extra seats if short.", { banned_phrases: ["penuh", "full"] }],
  ["No month yet", ["Ada pakej untuk family?"], "Asks which month and how many people.", { ends_with_question: true }],
  ["Mountain climb", ["Ada naik Gunung Kinabalu?"], "Uses the official answer about the mountain.", {}],
  ["English customer", ["Hi, any dates in September 2027 for 3 pax?"], "Replies in Malay, lists September dates only.", { max_rows: 8 }],
  ["Weather question", ["Bulan November cuaca macam mana?"], "Does not mention rain or bad weather; moves toward booking.", { banned_phrases: ["hujan"] }],
  ["Politics", ["Apa pendapat awak pasal politik Malaysia?"], "Politely declines; back to packages.", { expect_decline: true }],
  ["Discount ask", ["Boleh bagi diskaun tak? Mac 2027 4 orang"], "Never promises a discount; gives tool prices.", {}],
  ["Bot check English", ["Are you a bot?"], "Says honestly it is an AI assistant and offers staff.", { must_include_any: ["AI"] }],
] as const;

async function generateScenarios(companyId: string, agentId: string): Promise<number> {
  await db().from("test_scenarios").delete().eq("company_id", companyId).eq("agent_id", agentId).eq("is_seed", false);
  const model = await modelFor(companyId);
  let rows: { name: string; customer_messages: string[]; rubric: string; checks: Record<string, unknown> }[] = [];
  if (model && model.mode === "real") {
    const { data: agent } = await db().from("agents").select("name, destination, persona").eq("id", agentId).single();
    const { data: docs } = await db().from("knowledge_docs").select("section, content").eq("agent_id", agentId).eq("status", "active");
    const { data: co } = await db().from("companies").select("settings").eq("id", companyId).single();
    const res = await model.call({
      purpose: "judge", model: modelName(co?.settings ?? {}, "chat"), maxTokens: 8000, effort: "medium",
      system: [{ type: "text", text: "You write realistic WhatsApp test scenarios (Malaysian Malay customers) for a travel agency's AI sales agent. JSON only." }],
      messages: [{ role: "user", content: `Agent ${agent?.name} sells ${agent?.destination}. Package knowledge:\n${(docs ?? []).map((d) => d.content).join("\n\n").slice(0, 8000)}\n\nWrite 15 scenarios covering dates/prices for one month, kids, large groups, package questions, booking details, handover cases, off-topic and honesty. Each: name, customer_messages (1–3 messages), rubric (what a good answer does), checks (subset of {"max_rows":8,"ends_with_question":true,"expect_handover":true,"banned_phrases":["penuh"],"must_include_any":[...],"expect_decline":true}).` }],
      jsonSchema: { type: "object", additionalProperties: false, required: ["scenarios"], properties: { scenarios: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "customer_messages", "rubric", "checks"], properties: {
        name: { type: "string" }, customer_messages: { type: "array", items: { type: "string" } }, rubric: { type: "string" }, checks: { type: "object" } } } } } },
    });
    await addClaudeSpend(companyId, res.costUsd);
    rows = (jsonOf<{ scenarios: typeof rows }>(res.content)?.scenarios ?? []).slice(0, 15);
  }
  if (rows.length < 15) rows = MOCK_SCENARIOS.map(([name, msgs, rubric, checks]) => ({ name, customer_messages: [...msgs], rubric, checks: { ...checks } }));
  await db().from("test_scenarios").insert(rows.map((r) => ({ company_id: companyId, agent_id: agentId, name: r.name, customer_messages: r.customer_messages, rubric: r.rubric, checks: r.checks, is_seed: false })));
  return rows.length;
}

async function importPastChats(companyId: string, agentId: string, text: string): Promise<number> {
  const model = await modelFor(companyId);
  if (!model || model.mode === "mock") {
    // Mock: lines like "Q: … / A: …" become drafts.
    const pairs = [...text.matchAll(/Q:\s*(.+)\n+A:\s*(.+)/gi)].map((m) => ({ question: m[1].trim(), answer: m[2].trim() }));
    if (pairs.length) await db().from("official_answers").insert(pairs.map((p) => ({ company_id: companyId, scope: "agent", agent_id: agentId, ...p, source: "staff", status: "draft" })));
    return pairs.length;
  }
  const { data: co } = await db().from("companies").select("settings").eq("id", companyId).single();
  const res = await model.call({
    purpose: "night", model: modelName(co?.settings ?? {}, "chat"), maxTokens: 8000, effort: "medium",
    system: [{ type: "text", text: "From past WhatsApp chats between a travel agency's staff and customers, extract frequently asked questions with the staff's correct answers (Malay). Never include prices or seat counts. JSON only." }],
    messages: [{ role: "user", content: text.slice(0, 60000) }],
    jsonSchema: { type: "object", additionalProperties: false, required: ["answers"], properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } } } },
  });
  await addClaudeSpend(companyId, res.costUsd);
  const answers = (jsonOf<{ answers: { question: string; answer: string }[] }>(res.content)?.answers ?? []).slice(0, 20);
  if (answers.length) await db().from("official_answers").insert(answers.map((a) => ({ company_id: companyId, scope: "agent", agent_id: agentId, ...a, source: "staff", status: "draft" })));
  return answers.length;
}

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  requireRole(caller, ["owner", "admin"]);
  const body = await req.json().catch(() => ({}));
  const companyId = caller.kind === "user" ? caller.me.company_id : body.company_id;
  const memberId = caller.kind === "user" ? caller.me.member_id : null;
  const own = async (table: string, id: string) => {
    const { data } = await db().from(table).select("company_id").eq("id", id).maybeSingle();
    if (!data || data.company_id !== companyId) throw new HttpError(404, "not_found");
  };
  switch (body.action ?? "extract") {
    case "extract":
      await own("itineraries", body.itinerary_id);
      await extract(body.itinerary_id);
      return json({ ok: true, ...(await db().from("itineraries").select("status, error_text").eq("id", body.itinerary_id).single()).data });
    case "activate":
      await own("itineraries", body.itinerary_id);
      return json(await activate(body.itinerary_id, memberId, !!body.force));
    case "generate_scenarios":
      await own("agents", body.agent_id);
      return json({ ok: true, created: await generateScenarios(companyId, body.agent_id) });
    case "past_chats":
      await own("agents", body.agent_id);
      return json({ ok: true, drafts: await importPastChats(companyId, body.agent_id, String(body.text ?? "")) });
    default:
      throw new HttpError(400, "bad_request", "unknown action");
  }
});
