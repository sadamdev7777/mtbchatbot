// "Test connection" for each integration; a feature turns automatic only after its test passes.
import webpush from "web-push";
import { db } from "../_shared/db.ts";
import { META_GRAPH_VERSION } from "../_shared/env.ts";
import { getCaller, handle, HttpError, json, requireRole } from "../_shared/http.ts";
import { getIntegration, getSecret, type IntegrationKey } from "../_shared/integrations.ts";
import { testClaude } from "../_shared/providers/claude.ts";
import { RealMeta } from "../_shared/providers/meta.ts";
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
      if (!(await secret("app_secret"))) throw new Error("App Secret is required to verify webhooks");
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
