import { verifyMetaSignature } from "../_shared/crypto.ts";
import { db } from "../_shared/db.ts";
import { MOCK_APP_SECRET } from "../_shared/env.ts";
import { handle, json } from "../_shared/http.ts";
import { getSecret, useReal } from "../_shared/integrations.ts";
import { processPayload } from "./process.ts";

/** Which secret signs webhooks for this payload's company: the Meta App Secret, or the simulator secret in mock mode. */
async function appSecretFor(payload: any): Promise<string | null> {
  const phoneId = payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneId) return null;
  const { data: ch } = await db().from("channels").select("company_id").eq("phone_number_id", phoneId).maybeSingle();
  if (!ch) return null;
  if (await useReal(ch.company_id, "meta_whatsapp")) return await getSecret(ch.company_id, "meta_whatsapp", "app_secret");
  return MOCK_APP_SECRET();
}

export const handler = handle(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Meta webhook verification handshake
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token) {
      const { data } = await db().from("channels").select("id").eq("webhook_verify_token", token).limit(1);
      if (data?.length) return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const secret = await appSecretFor(payload);
  if (!secret || !(await verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret))) {
    return json({ error: "bad_signature" }, 401);
  }
  const result = await processPayload(payload);
  return json({ ok: true, ...result });
});
