import { expect, test } from "@playwright/test";
import { admin, conversationOf, customerSays, login, newNumber, runFunction, waitFor } from "./helpers";

test.describe.configure({ mode: "serial" });

test("inbound message → AI reply (debounced, routed, honest prefix, ≤ 8 dates)", async ({ page }) => {
  const wa = newNumber();
  await login(page, "sadam@mtb.test");
  await customerSays(page, wa, { text: "Assalamualaikum, nak tanya pakej Kundasang" });
  await customerSays(page, wa, { text: "bulan Mac 2027 untuk 2 orang" });
  const conv = await conversationOf(wa);
  await page.goto(`/inbox?tab=all&c=${conv.id}`);
  const chat = page.locator('section[aria-label="Conversation"]');
  await expect(chat.getByText('Nura (AI) · sent as "Pembantu AI · Farah"').first()).toBeVisible();
  await expect(chat.getByText("Cik nak saya kunci seat untuk tarikh mana?")).toBeVisible();
  await expect(chat.getByText(/Tool: search_products · KK Kundasang · Mac 2027/)).toBeVisible();
  const { data: ai } = await admin().from("messages").select("body").eq("conversation_id", conv.id).eq("sender_type", "ai").eq("type", "text");
  expect(ai!.length).toBeGreaterThan(0);
  expect(ai!.map((m) => m.body).join("\n").split("\n").filter((l) => l.startsWith("•")).length).toBeLessThanOrEqual(8);
});

test("handover → staff takes over → AI draft used", async ({ page, browser }) => {
  const wa = newNumber();
  await login(page, "sadam@mtb.test");
  await customerSays(page, wa, { text: "Kundasang Mac 2027 4 orang. Boleh book flight dari Alor Setar ke KLIA sekali?" });
  const conv0 = await conversationOf(wa);
  await waitFor(async () => (await admin().from("conversations").select("needs_staff").eq("id", conv0.id).single()).data?.needs_staff);

  const staff = await (await browser.newContext()).newPage();
  await login(staff, "farah@mtb.test");
  await staff.goto(`/inbox?tab=all&c=${conv0.id}`);
  const takeOver = staff.getByRole("button", { name: "Take over" }).last();
  if (await takeOver.isVisible()) await takeOver.click();
  await waitFor(async () => (await admin().from("conversations").select("holder_member_id").eq("id", conv0.id).single()).data?.holder_member_id);
  await expect(staff.getByText("Needs staff · ")).toHaveCount(0);

  await customerSays(page, wa, { text: "Kalau tanpa flight, Jun 2027 untuk 2 orang ada?" });
  await expect(staff.getByText("Draft by Nura")).toBeVisible({ timeout: 40_000 });
  await staff.getByRole("button", { name: "Use draft" }).click();
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  const draft = await waitFor(async () => {
    const { data } = await admin().from("ai_drafts").select("status").eq("conversation_id", conv0.id).in("status", ["used", "edited"]);
    return data?.length ? data : null;
  });
  expect(draft[0].status).toBe("used");
  const { data: sent } = await admin().from("messages").select("body").eq("conversation_id", conv0.id).eq("sender_type", "staff").order("created_at", { ascending: false }).limit(1).single();
  expect(sent!.body!.startsWith("*Farah*")).toBeTruthy();
});

test("24-hour window closed → only a template can be sent", async ({ page }) => {
  await login(page, "sadam@mtb.test");
  await page.goto("/broadcast/templates");
  const row = page.getByRole("row", { name: /susulan_pertanyaan_v1/ });
  await row.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText(/submitted to Meta/)).toBeVisible();
  await page.getByRole("button", { name: "Sync with Meta" }).click();
  await expect(row.getByText("APPROVED")).toBeVisible();

  await page.goto("/inbox?tab=all&c=70000000-0000-0000-0000-000000000002");
  await expect(page.getByText("Aqil owns this chat.").first()).toBeVisible(); // second staff member: notes only
  await page.getByRole("button", { name: "Take over" }).last().click();
  await expect(page.getByText("The 24-hour window has closed. Only Meta-approved templates can be sent.")).toBeVisible();
  await expect(page.locator("#reply")).toBeDisabled();
  await page.getByRole("button", { name: "Choose template" }).click();
  await page.getByRole("button", { name: /susulan_pertanyaan_v1/ }).click();
  await page.getByRole("button", { name: "Send template" }).click();
  await expect(page.locator('section[aria-label="Conversation"]').getByText("Template · susulan_pertanyaan_v1")).toBeVisible();
});

test("seat lock → receipt → payment verification → after-sales", async ({ page }) => {
  const wa = newNumber();
  await login(page, "sadam@mtb.test");
  await customerSays(page, wa, { text: "Pakej Kundasang Mei 2027 untuk 2 orang" });
  const conv = await conversationOf(wa);
  await waitFor(async () => (await admin().from("conversations").select("key_details").eq("id", conv.id).single()).data?.key_details?.asked_group_ids);
  await customerSays(page, wa, { text: "Saya ambil tarikh pertama. Aminah binti Yusof, 850101-10-1234, aminah@example.com" });
  const link = await waitFor(async () => {
    const { data } = await admin().from("messages").select("body").eq("conversation_id", conv.id).eq("sender_type", "ai").ilike("body", "%mock_lock=%");
    return data?.[0]?.body?.match(/https?:\/\/\S+mock_lock=\S+/)?.[0];
  });
  // customer fills the (mock) TravelBoost form
  await page.goto(link);
  await page.getByRole("button", { name: "Kunci seat sekarang" }).click();
  await expect(page.getByText("Seat dikunci")).toBeVisible();
  const locked = await waitFor(async () => (await admin().from("conversations").select("booking_ref, needs_staff_reason").eq("id", conv.id).single()).data?.booking_ref && (await admin().from("conversations").select("*").eq("id", conv.id).single()).data);
  expect(locked.needs_staff_reason).toContain("send payment link");

  // receipt image in chat
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await customerSays(page, wa, { image: png, text: `Resit RM600 ${locked.booking_ref}` });
  const pv = await waitFor(async () => (await admin().from("payment_verifications").select("id, status").eq("conversation_id", conv.id).maybeSingle()).data);
  expect(pv.status).toBe("pending");

  await page.goto("/payments");
  await expect(page.getByText(locked.booking_ref).first()).toBeVisible();
  await page.getByRole("button", { name: "Verify payment" }).first().click();
  await expect(page.getByText(/Verified MTB-/)).toBeVisible();
  const after = await waitFor(async () => (await admin().from("conversations").select("stage").eq("id", conv.id).single()).data?.stage === "deposit");
  expect(after).toBeTruthy();
  await runFunction("followup-runner", { tasks: ["followups"] });
  const { data: jobs } = await admin().from("followup_jobs").select("step_key, status").eq("conversation_id", conv.id).eq("kind", "aftersales");
  expect(jobs!.find((j) => j.step_key === "aftersales:on_deposit")!.status).toBe("done");
  expect(jobs!.some((j) => j.step_key === "aftersales:d60_passport" && j.status === "pending")).toBeTruthy();
  const { data: receipt } = await admin().from("messages").select("body").eq("conversation_id", conv.id).ilike("body", "%telah disahkan%");
  expect(receipt!.length).toBe(1);
});

test("itinerary upload → questions → activate", async ({ page }) => {
  await login(page, "sadam@mtb.test");
  await page.goto("/ai/itinerary/new?agent=50000000-0000-0000-0000-000000000001");
  await page.setInputFiles("#it-file", { name: "TENTATIF KK 2027.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
  await page.getByRole("button", { name: "Upload and read" }).click();
  await page.waitForURL(/\/ai\/itinerary\/[0-9a-f-]{36}/);
  await expect(page.getByText(/Claude needs your answer on 2 items/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate for bot" })).toBeDisabled();
  await page.getByRole("button", { name: "Yes, hotel breakfast" }).click();
  await page.getByRole("button", { name: "Free under 3" }).click();
  await page.getByRole("button", { name: "Activate for bot" }).click();
  await expect(page.getByText(/Activated for the bot/)).toBeVisible({ timeout: 60_000 });
});

test("broadcast reaches opted-in contacts and skips anyone who replied STOP", async ({ page }) => {
  const yes = newNumber(), stop = newNumber();
  await login(page, "sadam@mtb.test");
  await customerSays(page, yes, { text: "Hi" });
  await customerSays(page, stop, { text: "Hi" });
  await customerSays(page, stop, { text: "STOP" });
  const db = admin();
  const { data: contacts } = await db.from("contacts").select("id, wa_id, opted_out_at").in("wa_id", [yes, stop]);
  expect(contacts!.find((c) => c.wa_id === stop)!.opted_out_at).toBeTruthy();

  // pick the two contacts on the Contacts page and add them to a broadcast
  await page.goto("/contacts");
  for (const c of contacts!) await page.evaluate((id) => sessionStorage.setItem("broadcast_contacts", JSON.stringify([...(JSON.parse(sessionStorage.getItem("broadcast_contacts") ?? "[]")), id])), c.id);
  await page.goto("/broadcast?new=1&from=contacts");
  await expect(page.getByText(/1 recipients/)).toBeVisible();
  await page.fill("#b-name", "E2E opt-out check");
  await page.selectOption("#b-tpl", "susulan_pertanyaan_v1");
  await page.getByLabel("Variable 2 value").fill("Farah");
  await page.getByLabel("Variable 3 value").fill("KK Kundasang");
  await page.getByLabel("Send now").check();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(/Sending now in batches/)).toBeVisible();
  await runFunction("followup-runner", { tasks: ["broadcasts"] });
  await runFunction("followup-runner", { tasks: ["broadcasts"] });
  const { data: b } = await db.from("broadcasts").select("id, status").eq("name", "E2E opt-out check").single();
  const { data: rec } = await db.from("broadcast_recipients").select("contact_id, status").eq("broadcast_id", b!.id);
  expect(rec!.length).toBe(1);
  expect(rec![0].contact_id).toBe(contacts!.find((c) => c.wa_id === yes)!.id);
  expect(rec![0].status).toBe("sent");
  expect(b!.status).toBe("sent");
});
