// "Test connection" for each integration; a feature turns automatic only after its test passes.
import webpush from "web-push";
import { db } from "../_shared/db.ts";
import { META_GRAPH_VERSION, MOCK_PROVIDERS, REAL_PROVIDERS } from "../_shared/env.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { getIntegration, getSecret, type IntegrationKey, realAllowed } from "../_shared/integrations.ts";
import { testClaude } from "../_shared/providers/claude.ts";
import { RealMeta } from "../_shared/providers/meta.ts";
import { completeEmbeddedSignup, newPin } from "../_shared/providers/meta-signup.ts";
import { listAds, realBankFor, testHrBoost, testMetaAds, testSmtp } from "../_shared/providers/others.ts";
import { realTravelBoostFor } from "../_shared/providers/travelboost.ts";

async function runTest(companyId: string, key: IntegrationKey): Promise<string> {
  const i = await getIntegration(companyId, key);
  const c = i.config;
  const secret = (f: string) => getSecret(companyId, key, f);
  switch (key) {
    case "meta_whatsapp": {
      const token = await secret("token");
      if (!c.phone_number_id || !c.waba_id || !token) throw new Error("WABA ID, phone number ID and token are required");
      const appSecret = await secret("app_secret");
      if (!appSecret) throw new Error("App Secret is required to verify webhooks");
      if (!/^\d{6,20}$/.test(String(c.waba_id)) || !/^\d{6,20}$/.test(String(c.phone_number_id))) {
        throw new Error("WhatsApp Business Account ID and Phone number ID must be the numeric IDs from Meta App › WhatsApp › API Setup (not the demo values or the phone number)");
      }
      if (appSecret === token || /^EAA/.test(appSecret)) throw new Error("The App Secret field holds the access token. Paste the App Secret from App settings › Basic instead");
      const meta = new RealMeta({ phoneNumberId: c.phone_number_id, wabaId: c.waba_id, token }, c.graph_version || META_GRAPH_VERSION());
      const q = await meta.phoneQuality();
      const t = await meta.listTemplates();
      return `Number quality ${q?.quality_rating}, tier ${q?.messaging_limit_tier}; ${t.length} templates found`;
    }
    case "smtp":
      if (!c.host || !c.from) throw new Error("Host and From address are required");
      return await testSmtp({ host: c.host, port: Number(c.port ?? 587), user: c.user, password: (await secret("password")) ?? undefined });
    case "web_push": {
      const priv = await secret("private_key");
      if (!c.public_key || !priv) throw new Error("Generate the VAPID keys first");
      webpush.setVapidDetails(c.subject ?? "mailto:ops@muslimtravelbug.com", c.public_key, priv);
      return "VAPID keys are valid";
    }
    case "claude": {
      const k = await secret("api_key");
      if (!k) throw new Error("API key is required");
      return await testClaude(k);
    }
    case "travelboost": {
      const tb = await realTravelBoostFor(companyId);
      const month = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 7);
      const r = await tb.searchProducts({ month, pax: 1 });
      if (!(await secret("webhook_secret"))) throw new Error("Webhook secret is required to verify TravelBoost events");
      return `TravelBoost answered: ${r.total} departures in ${month}`;
    }
    case "bank_email": {
      if (!String(c.trusted_senders ?? "").trim()) throw new Error("Add at least one trusted sender address");
      return await (await realBankFor(companyId)).test();
    }
    case "hrboost": {
      const k = await secret("api_key");
      if (!c.base_url || !k) throw new Error("Base URL and API key are required");
      return await testHrBoost(c.base_url, k);
    }
    case "meta_ads": {
      const token = (await secret("token")) ?? (await getSecret(companyId, "meta_whatsapp", "token"));
      if (!c.ad_account_id || !token) throw new Error("Ad account ID and a token with ads_read are required");
      return await testMetaAds(c.ad_account_id, token, c.graph_version || META_GRAPH_VERSION());
    }
    case "sleekflow":
      throw new Error("SleekFlow is a one-off CSV import: use Contacts › Import CSV");
  }
}

export const handler = handle(async (req) => {
  const caller = await getCaller(req);
  requireRole(caller, ["owner", "admin"]);
  const body = await req.json().catch(() => ({}));
  const companyId = caller.kind === "user" ? caller.me.company_id : body.company_id;
  if (!companyId) throw new HttpError(400, "bad_request", "company_id required");

  if (body.action === "generate_vapid") {
    requireRole(caller, ["owner"]);
    const keys = webpush.generateVAPIDKeys();
    const i = await getIntegration(companyId, "web_push");
    await db().from("integrations").update({ config: { ...i.config, public_key: keys.publicKey, subject: i.config.subject ?? "mailto:ops@muslimtravelbug.com" } }).eq("company_id", companyId).eq("key", "web_push");
    await db().rpc("service_set_integration_secret", { p_company: companyId, p_key: "web_push", p_field: "private_key", p_value: keys.privateKey });
    return json({ ok: true, public_key: keys.publicKey });
  }
  if (body.action === "list_ads") {
    return json({ ok: true, ads: await listAds(companyId) });
  }

  if (body.action === "meta_signup_info") {
    const i = await getIntegration(companyId, "meta_whatsapp");
    const hasSecret = !!(await getSecret(companyId, "meta_whatsapp", "app_secret"));
    return json({
      ok: true, mock: !realAllowed("meta_whatsapp", MOCK_PROVIDERS(), REAL_PROVIDERS()), app_id: i.config.app_id ?? "", config_id: i.config.es_config_id ?? "",
      graph_version: i.config.graph_version || META_GRAPH_VERSION(), has_app_secret: hasSecret,
    });
  }
  if (body.action === "meta_embedded_signup") {
    requireRole(caller, ["owner"]);
    return json(await embeddedSignup(companyId, body));
  }

  const key = body.key as IntegrationKey;
  if (!key) throw new HttpError(400, "bad_request", "key required");
  const started = Date.now();
  try {
    const message = await runTest(companyId, key);
    const result = { ok: true, message, ms: Date.now() - started };
    await db().rpc("record_integration_test", { p_company: companyId, p_key: key, p_ok: true, p_result: result });
    return json(result);
  } catch (e) {
    const result = { ok: false, message: (e as Error).message, ms: Date.now() - started };
    await db().rpc("record_integration_test", { p_company: companyId, p_key: key, p_ok: false, p_result: result });
    return json({ ok: false, error: "test_failed", message: result.message }, 200);
  }
});

/** "Connect with Facebook": finish WhatsApp Embedded Signup, store the token in the vault, then run the normal test. */
async function embeddedSignup(companyId: string, body: { code?: string; waba_id?: string; phone_number_id?: string }) {
  const code = String(body.code ?? "");
  if (!code) throw new HttpError(400, "bad_request", "Missing the code from Facebook");
  const i = await getIntegration(companyId, "meta_whatsapp");
  const save = async (config: Record<string, unknown>, token: string) => {
    await db().from("integrations").update({ config: { ...i.config, ...config } }).eq("company_id", companyId).eq("key", "meta_whatsapp");
    await db().rpc("service_set_integration_secret", { p_company: companyId, p_key: "meta_whatsapp", p_field: "token", p_value: token });
  };

  if (!realAllowed("meta_whatsapp", MOCK_PROVIDERS(), REAL_PROVIDERS())) {
    // Demo: the mock Facebook dialog. Keeps the simulator's phone number so demo chats keep working.
    if (!code.startsWith("mock-")) throw new HttpError(400, "bad_request", "Demo mode only accepts the mock Facebook dialog");
    const phone = String(body.phone_number_id || "mock-phone-1");
    await save({ waba_id: String(body.waba_id || "mock-waba-1"), phone_number_id: phone, display_phone: i.config.display_phone || "+60 3-2788 0000", connected_via: "embedded_signup" }, `mock-token-${crypto.randomUUID().slice(0, 8)}`);
    const result = { ok: true, message: "Demo: connected through the mock Facebook dialog (no real messages are sent).", ms: 0 };
    await db().rpc("record_integration_test", { p_company: companyId, p_key: "meta_whatsapp", p_ok: true, p_result: result });
    return result;
  }

  const appSecret = await getSecret(companyId, "meta_whatsapp", "app_secret");
  if (!i.config.app_id || !appSecret) throw new HttpError(400, "not_configured", "Save the Meta App ID and App Secret first");
  const pin = newPin();
  const r = await completeEmbeddedSignup({
    appId: String(i.config.app_id), appSecret, code, wabaId: String(body.waba_id ?? ""), phoneNumberId: String(body.phone_number_id ?? ""),
    pin, version: i.config.graph_version || META_GRAPH_VERSION(),
  });
  await save({ waba_id: r.wabaId, phone_number_id: r.phoneNumberId, display_phone: r.displayPhone ?? i.config.display_phone, verified_name: r.verifiedName, connected_via: "embedded_signup" }, r.token);
  if (r.registered) await db().rpc("service_set_integration_secret", { p_company: companyId, p_key: "meta_whatsapp", p_field: "two_step_pin", p_value: pin });

  const started = Date.now();
  try {
    const message = await runTest(companyId, "meta_whatsapp");
    const result = { ok: true, message: [`Connected ${r.verifiedName ?? ""} ${r.displayPhone ?? ""}`.trim() + ".", message, ...r.warnings].join(" "), ms: Date.now() - started };
    await db().rpc("record_integration_test", { p_company: companyId, p_key: "meta_whatsapp", p_ok: true, p_result: result });
    return result;
  } catch (e) {
    const result = { ok: false, message: (e as Error).message, ms: Date.now() - started };
    await db().rpc("record_integration_test", { p_company: companyId, p_key: "meta_whatsapp", p_ok: false, p_result: result });
    return { ...result, error: "test_failed" };
  }
}
