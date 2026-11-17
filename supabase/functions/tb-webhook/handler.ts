// TravelBoost gateway:
//  • POST with X-TravelBoost-Signature: signed webhook events (exactly-once by event id)
//  • POST {action: ...} with a user JWT: lookups for the app (a contact's bookings)
//  • GET ?mock_lock=ID: the mock seat-lock form (mock mode only)
import { hmacSha256Hex, safeEqual } from "../_shared/crypto.ts";
import { normalizePhone } from "../_shared/core/rules.ts";
import { db } from "../_shared/db.ts";
import { getCaller, handle, HttpError, json } from "../_shared/http.ts";
import { getSecret, useReal } from "../_shared/integrations.ts";
import { MockTravelBoost, travelBoostFor } from "../_shared/providers/travelboost.ts";
import { handleTravelBoostEvent } from "./events.ts";

export const MOCK_TB_SECRET = () => Deno.env.get("TRAVELBOOST_MOCK_SECRET") ?? "mock-travelboost-secret";

async function secretFor(companyId: string): Promise<string | null> {
  if (await useReal(companyId, "travelboost")) return await getSecret(companyId, "travelboost", "webhook_secret");
  return MOCK_TB_SECRET();
}

export async function signTravelBoost(body: string, secret = MOCK_TB_SECRET()): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, body)}`;
}

async function companyFromRequest(url: URL): Promise<string> {
  const c = url.searchParams.get("company");
  if (c) return c;
  const { data } = await db().from("companies").select("id").order("created_at").limit(1).single();
  return data!.id;
}

function page(title: string, body: string): Response {
  return new Response(`<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#F6F7F9;color:#101828;margin:0;padding:24px}main{max-width:420px;margin:auto;background:#fff;border:1px solid #E4E7EC;border-radius:16px;padding:24px}button{height:44px;border:0;border-radius:8px;background:#0E7C66;color:#fff;font-weight:600;padding:0 18px;width:100%}p{line-height:1.5}</style></head>
<body><main>${body}</main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export const handler = handle(async (req) => {
  const url = new URL(req.url);

  // --- mock seat-lock form -----------------------------------------------------
  if (url.searchParams.get("mock_lock")) {
    const companyId = await companyFromRequest(url);
    if (await useReal(companyId, "travelboost")) throw new HttpError(404, "not_found");
    const lockId = url.searchParams.get("mock_lock")!;
    if (req.method === "GET") {
      return page("Kunci seat · TravelBoost (mock)", `<h1>Kunci seat</h1><p>Ini borang TravelBoost <strong>mock</strong> untuk ujian. Tekan butang untuk kunci seat selama 24 jam.</p>
        <form method="post"><button type="submit">Kunci seat sekarang</button></form>`);
    }
    const booking = await new MockTravelBoost(companyId).completeLock(lockId);
    const event = { id: `evt_${crypto.randomUUID()}`, type: "seat.locked", created_at: new Date().toISOString(),
      data: { lock_id: lockId, booking_id: booking.id, group_id: booking.group_id, lead_phone: booking.lead_phone, lead_name: booking.lead_name,
        pax: booking.pax.adults, start_date: booking.start_date, product_id: booking.product_id, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() } };
    await handleTravelBoostEvent(companyId, event);
    return page("Seat dikunci", `<h1>Seat dikunci ✅</h1><p>Tempahan <strong>${booking.id}</strong> untuk ${booking.pax.adults} orang pada ${booking.start_date}. Staf MTB akan hantar pautan bayaran deposit.</p>`);
  }

  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
  const raw = await req.text();
  const sig = req.headers.get("x-travelboost-signature");

  // --- signed webhook ------------------------------------------------------------
  if (sig) {
    const companyId = await companyFromRequest(url);
    const secret = await secretFor(companyId);
    if (!secret || !safeEqual(sig, await signTravelBoost(raw, secret))) return json({ error: "bad_signature" }, 401);
    const event = JSON.parse(raw);
    if (!event?.id || !event?.type) throw new HttpError(400, "bad_request", "event id and type required");
    const { error } = await db().from("webhook_events").insert({ company_id: companyId, source: "travelboost", event_id: event.id, payload: event });
    if (error?.code === "23505") return json({ ok: true, duplicate: true });
    const result = await handleTravelBoostEvent(companyId, event);
    await db().from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("source", "travelboost").eq("event_id", event.id);
    return json({ ok: true, ...result });
  }

  // --- app lookups (signed-in staff) -------------------------------------------
  const caller = await getCaller(new Request(req.url, { headers: req.headers }));
  const body = raw ? JSON.parse(raw) : {};
  if (caller.kind !== "user") throw new HttpError(403, "forbidden");
  if (body.action === "contact_bookings") {
    if (caller.me.role === "accounts") throw new HttpError(403, "forbidden");
    const { data: contact } = await db().from("contacts").select("wa_id, company_id, owner_member_id").eq("id", body.contact_id).maybeSingle();
    if (!contact || contact.company_id !== caller.me.company_id) throw new HttpError(404, "not_found");
    const tb = await travelBoostFor(caller.me.company_id);
    const customer = await tb.findCustomer(normalizePhone(contact.wa_id));
    return json({ ok: true, mode: tb.mode, bookings: customer?.bookings ?? [] });
  }
  if (body.action === "product" && body.product_id) {
    const tb = await travelBoostFor(caller.me.company_id);
    const product = await tb.getProduct(body.product_id);
    const month = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 7);
    const dates = product ? await tb.searchProducts({ product_ids: [product.id], month, pax: 1 }) : null;
    return json({ ok: true, mode: tb.mode, product, sample: dates?.rows.slice(0, 3) ?? [], dates_next_month: dates?.total ?? 0 });
  }
  if (body.action === "booking" && body.booking_id) {
    const tb = await travelBoostFor(caller.me.company_id);
    return json({ ok: true, booking: await tb.getBooking(body.booking_id) });
  }
  throw new HttpError(400, "bad_request", "unknown action");
});
