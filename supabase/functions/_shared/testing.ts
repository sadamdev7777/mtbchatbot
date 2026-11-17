// Helpers for Deno integration tests against the local Supabase stack (`supabase start` + seed).
import { createClient } from "@supabase/supabase-js";
import { hmacSha256Hex } from "./crypto.ts";
import { db } from "./db.ts";
import { ANON_KEY, MOCK_APP_SECRET, SUPABASE_URL } from "./env.ts";

// Deno tests call the orchestrator themselves; no background AI runs racing the assertions.
Deno.env.set("DISABLE_AI_AUTOTRIGGER", "true");

export const COMPANY = "00000000-0000-0000-0000-000000000001";
export const CHANNEL_PHONE_ID = "mock-phone-1";
export const MEMBERS = { owner: "20000000-0000-0000-0000-000000000001", admin: "20000000-0000-0000-0000-000000000002", aqil: "20000000-0000-0000-0000-000000000003", farah: "20000000-0000-0000-0000-000000000004", hakim: "20000000-0000-0000-0000-000000000005" };
export const AGENTS = { nura: "50000000-0000-0000-0000-000000000001", sari: "50000000-0000-0000-0000-000000000002" };
export const TEAMS = { sabah: "30000000-0000-0000-0000-000000000001", overseas: "30000000-0000-0000-0000-000000000002", general: "30000000-0000-0000-0000-000000000003" };

let serverStarted = false;
/** Start the functions dev router in-process (functions call each other over HTTP). */
export async function ensureFunctionsServer() {
  if (serverStarted) return;
  serverStarted = true;
  try {
    const r = await fetch("http://127.0.0.1:54329/functions/v1/none");
    await r.body?.cancel();
  } catch {
    await import("../_dev/serve.ts");
  }
}

export function randomWaId(): string {
  return "6019" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

export function inboundPayload(opts: { from: string; name?: string; text?: string; id?: string; referral?: unknown; button?: { id: string; title: string }; ts?: number }) {
  const message: Record<string, unknown> = {
    from: opts.from, id: opts.id ?? `wamid.test.${crypto.randomUUID()}`, timestamp: String(Math.floor((opts.ts ?? Date.now()) / 1000)),
  };
  if (opts.button) Object.assign(message, { type: "interactive", interactive: { type: "button_reply", button_reply: opts.button } });
  else Object.assign(message, { type: "text", text: { body: opts.text ?? "hello" } });
  if (opts.referral) message.referral = opts.referral;
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "mock-waba-1", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "60327880000", phone_number_id: CHANNEL_PHONE_ID },
      contacts: [{ wa_id: opts.from, profile: { name: opts.name ?? "Test Customer" } }], messages: [message],
    } }] }],
  };
}

export function statusPayload(waMessageId: string, status: string, errorCode?: number) {
  const s: Record<string, unknown> = { id: waMessageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "60" };
  if (errorCode) s.errors = [{ code: errorCode, title: "Re-engagement message" }];
  return { object: "whatsapp_business_account", entry: [{ id: "mock-waba-1", changes: [{ field: "messages", value: { metadata: { phone_number_id: CHANNEL_PHONE_ID }, statuses: [s] } }] }] };
}

export async function signedRequest(url: string, payload: unknown, secret = MOCK_APP_SECRET()): Promise<Request> {
  const raw = JSON.stringify(payload);
  return new Request(url, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${await hmacSha256Hex(secret, raw)}` } });
}

export async function loginJwt(email: string): Promise<string> {
  const c = createClient(SUPABASE_URL(), ANON_KEY(), { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: "Password123!" });
  if (error) throw error;
  return data.session!.access_token;
}

export async function conversationFor(waId: string) {
  const { data: contact } = await db().from("contacts").select("*").eq("company_id", COMPANY).eq("wa_id", waId).single();
  const { data: conv } = await db().from("conversations").select("*").eq("contact_id", contact!.id).single();
  return { contact: contact!, conv: conv! };
}

export async function approveTemplate(name: string) {
  await db().from("templates").update({ status: "APPROVED" }).eq("company_id", COMPANY).eq("name", name);
}

export const testOpts = { sanitizeOps: false, sanitizeResources: false };
