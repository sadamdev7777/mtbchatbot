import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const FUNCTIONS = "http://127.0.0.1:54329/functions/v1";

export const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

export function newNumber(): string {
  return "6017" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

const sessions = new Map<string, any>();

/** Log in; owners/admins fetch their 2-step code from Mailpit. Sessions are reused across tests (2-step codes are rate-limited). */
export async function login(page: Page, email: string) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    await page.goto("/inbox");
    if (!page.url().includes("/login")) return;
  }
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#pw", "Password123!");
  const since = Date.now() - 2000;
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(login\/verify|inbox|dashboard|payments)/);
  if (page.url().includes("/login/verify")) {
    let code = "";
    for (let i = 0; i < 40 && !code; i++) {
      await page.waitForTimeout(250);
      const res = await fetch("http://127.0.0.1:54324/api/v1/messages");
      const j = await res.json();
      const m = j.messages.find((x: any) => x.To[0].Address === email && Date.parse(x.Created) >= since);
      if (m) code = m.Subject.match(/(\d{6})/)[1];
    }
    expect(code).not.toBe("");
    await page.fill("#code", code);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/(inbox|dashboard|payments)/);
  }
  sessions.set(email, await page.context().storageState());
}

/** Customer side: post a simulated inbound WhatsApp message (needs an owner/admin session). */
export async function customerSays(page: Page, waId: string, body: Record<string, unknown>) {
  const r = await page.request.post("/api/dev/simulate", { data: { wa_id: waId, name: "Pelanggan E2E", ...body } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

export async function conversationOf(waId: string) {
  const db = admin();
  const { data: c } = await db.from("contacts").select("id").eq("wa_id", waId).single();
  const { data: conv } = await db.from("conversations").select("*").eq("contact_id", c!.id).single();
  return conv!;
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 40_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out waiting");
}

export async function runFunction(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${FUNCTIONS}/${name}`, { method: "POST", headers: { authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
