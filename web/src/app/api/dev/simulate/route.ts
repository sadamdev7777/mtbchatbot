import { createHmac } from "node:crypto";
import { apiCaller, json } from "@/lib/api";
import { FUNCTIONS_URL } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Dev simulator: builds Meta-shaped webhook payloads and posts them to wa-webhook signed with the
 * mock app secret. wa-webhook only accepts that secret while Meta WhatsApp is not connected.
 */
export async function POST(req: Request) {
  const caller = await apiCaller(["owner", "admin"]);
  if (!caller) return json({ error: "Not allowed" }, 403);
  const admin = supabaseAdmin();
  const { data: integ } = await admin.from("integrations").select("status").eq("company_id", caller.me.company_id).eq("key", "meta_whatsapp").single();
  if (integ?.status === "connected" && process.env.MOCK_PROVIDERS !== "true") return json({ error: "Meta is connected: the simulator is off" }, 400);
  const { data: channel } = await admin.from("channels").select("phone_number_id").eq("company_id", caller.me.company_id).limit(1).single();
  const b = await req.json();
  if (b.kind === "bank_email") {
    // Mock bank inbox: the next poll reads it (MOCK_PROVIDERS only).
    await admin.from("mock_state").insert({ company_id: caller.me.company_id, kind: "bank_email", ref: `sim-${crypto.randomUUID()}`, data: {
      from: b.from || "alerts@maybank.com.my", subject: "Fund transfer received", received_at: new Date().toISOString(),
      text: `Amount: RM${Number(b.amount).toFixed(2)}\nDate: ${new Date().toISOString().slice(0, 10)}\nSender name: ${b.sender_name ?? ""}\nRecipient reference: ${b.reference ?? ""}`,
    } });
    const base = process.env.FUNCTIONS_INTERNAL_URL ?? FUNCTIONS_URL;
    const res = await fetch(`${base}/bank-email-poller`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify({ action: "poll" }) });
    return json(await res.json().catch(() => ({})), res.status);
  }
  const ts = String(Math.floor(Date.now() / 1000));
  let value: Record<string, unknown>;
  if (b.kind === "status") {
    const s: Record<string, unknown> = { id: b.wa_message_id, status: b.status, timestamp: ts, recipient_id: b.wa_id };
    if (b.status === "failed") s.errors = [{ code: Number(b.error_code ?? 131047), title: b.error_code === 131026 ? "Message undeliverable" : "Re-engagement message" }];
    value = { messaging_product: "whatsapp", metadata: { phone_number_id: channel!.phone_number_id }, statuses: [s] };
  } else {
    const wa = String(b.wa_id ?? "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(wa)) return json({ error: "Enter a phone number with country code" }, 400);
    const m: Record<string, unknown> = { from: wa, id: `wamid.sim.${crypto.randomUUID()}`, timestamp: ts };
    if (b.button) Object.assign(m, { type: "interactive", interactive: { type: "button_reply", button_reply: b.button } });
    else if (b.quick_reply) Object.assign(m, { type: "button", button: { text: b.quick_reply, payload: b.quick_reply } });
    else if (b.image) Object.assign(m, { type: "image", image: { id: b.image, mime_type: b.image.slice(5, b.image.indexOf(";")), caption: b.text || undefined } });
    else Object.assign(m, { type: "text", text: { body: String(b.text ?? "") } });
    if (b.referral_source_id) m.referral = { source_url: "https://fb.me/ad", source_id: b.referral_source_id, source_type: "ad", headline: b.referral_headline ?? "Ad", body: "" };
    value = { messaging_product: "whatsapp", metadata: { display_phone_number: "60327880000", phone_number_id: channel!.phone_number_id }, contacts: [{ wa_id: wa, profile: { name: b.name || "Simulated customer" } }], messages: [m] };
  }
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "sim", changes: [{ field: "messages", value }] }] });
  const sig = createHmac("sha256", process.env.META_MOCK_APP_SECRET ?? "mock-app-secret").update(raw).digest("hex");
  const base = process.env.FUNCTIONS_INTERNAL_URL ?? FUNCTIONS_URL;
  const res = await fetch(`${base}/wa-webhook`, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${sig}` } });
  return json(await res.json().catch(() => ({})), res.status);
}
