// WhatsApp Embedded Signup ("Connect with Facebook"): the browser gets a one-time code plus the
// WABA and phone number the owner picked; everything below runs server-side with the App Secret.

export interface SignupInput {
  appId: string;
  appSecret: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  pin: string;
  version: string;
}

export interface SignupResult {
  token: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string | null;
  verifiedName: string | null;
  registered: boolean;
  warnings: string[];
}

type Fetch = typeof fetch;

async function graph(f: Fetch, url: string, init: RequestInit = {}): Promise<any> {
  const res = await f(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw Object.assign(new Error(err.error_user_msg ?? err.message ?? `Meta HTTP ${res.status}`), { code: String(err.code ?? res.status) });
  }
  return body;
}

export async function completeEmbeddedSignup(i: SignupInput, f: Fetch = fetch): Promise<SignupResult> {
  if (!/^\d+$/.test(i.wabaId) || !/^\d+$/.test(i.phoneNumberId)) throw new Error("Facebook did not return a WhatsApp account and phone number");
  const base = `https://graph.facebook.com/${i.version}`;
  const warnings: string[] = [];

  // 1) one-time code → business integration token (never leaves the server)
  const q = new URLSearchParams({ client_id: i.appId, client_secret: i.appSecret, code: i.code });
  const tok = await graph(f, `${base}/oauth/access_token?${q}`);
  const token = String(tok.access_token ?? "");
  if (!token) throw new Error("Facebook did not return an access token");
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  // 2) receive this WABA's webhooks in our app
  await graph(f, `${base}/${i.wabaId}/subscribed_apps`, { method: "POST", headers: auth });

  // 3) number details
  const num = await graph(f, `${base}/${i.phoneNumberId}?fields=display_phone_number,verified_name,platform_type`, { headers: auth });

  // 4) register the number for Cloud API (sets the two-step PIN we keep in the vault)
  let registered = num.platform_type === "CLOUD_API";
  if (!registered) {
    try {
      await graph(f, `${base}/${i.phoneNumberId}/register`, { method: "POST", headers: auth, body: JSON.stringify({ messaging_product: "whatsapp", pin: i.pin }) });
      registered = true;
    } catch (e) {
      warnings.push(`Number not registered yet: ${(e as Error).message}. If the number already has a two-step PIN, remove it in WhatsApp Manager and connect again.`);
    }
  }

  return {
    token, wabaId: i.wabaId, phoneNumberId: i.phoneNumberId,
    displayPhone: num.display_phone_number ?? null, verifiedName: num.verified_name ?? null, registered, warnings,
  };
}

export function newPin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export interface FoundNumber { wabaId: string; phoneNumberId: string; displayPhone: string | null; verifiedName: string | null }

/**
 * Find the WhatsApp Business Account and phone number a saved token can reach, so the owner does not
 * have to copy the numeric IDs from Meta. Uses the token's own scopes (debug_token), then falls back to
 * the businesses the token can see. Prefers the number whose display phone matches `preferPhone`.
 */
export async function discoverWhatsApp(token: string, version: string, preferPhone = "", f: Fetch = fetch): Promise<{ found: FoundNumber | null; choices: FoundNumber[] }> {
  const base = `https://graph.facebook.com/${version}`;
  const auth = { authorization: `Bearer ${token}` };
  const wabas = new Set<string>();

  try {
    const dbg = await graph(f, `${base}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: auth });
    for (const s of dbg?.data?.granular_scopes ?? []) {
      if (String(s.scope).startsWith("whatsapp_business")) for (const id of s.target_ids ?? []) wabas.add(String(id));
    }
  } catch { /* fall through to businesses */ }

  if (!wabas.size) {
    const biz = await graph(f, `${base}/me/businesses?fields=id&limit=50`, { headers: auth }).catch(() => ({ data: [] }));
    for (const b of biz.data ?? []) {
      for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const r = await graph(f, `${base}/${b.id}/${edge}?fields=id&limit=50`, { headers: auth }).catch(() => ({ data: [] }));
        for (const w of r.data ?? []) wabas.add(String(w.id));
      }
    }
  }

  const choices: FoundNumber[] = [];
  for (const wabaId of wabas) {
    const r = await graph(f, `${base}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=50`, { headers: auth }).catch(() => ({ data: [] }));
    for (const p of r.data ?? []) {
      choices.push({ wabaId, phoneNumberId: String(p.id), displayPhone: p.display_phone_number ?? null, verifiedName: p.verified_name ?? null });
    }
  }
  const digits = (s: string | null) => String(s ?? "").replace(/\D/g, "");
  const want = digits(preferPhone);
  const match = want ? choices.find((c) => digits(c.displayPhone).endsWith(want.slice(-9))) : undefined;
  return { found: match ?? (choices.length === 1 ? choices[0] : null), choices };
}
