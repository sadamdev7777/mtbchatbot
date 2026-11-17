import { db } from "./db.ts";
import { MOCK_PROVIDERS } from "./env.ts";

export type IntegrationKey = "meta_whatsapp" | "smtp" | "web_push" | "claude" | "travelboost" | "bank_email" | "hrboost" | "meta_ads" | "sleekflow";

export interface IntegrationState {
  key: IntegrationKey;
  status: "not_connected" | "connected" | "error";
  config: Record<string, any>;
  secretFields: string[];
}

export async function getIntegration(companyId: string, key: IntegrationKey): Promise<IntegrationState> {
  const { data } = await db().from("integrations").select("key,status,config,secret_refs").eq("company_id", companyId).eq("key", key).maybeSingle();
  return {
    key,
    status: (data?.status ?? "not_connected") as IntegrationState["status"],
    config: (data?.config ?? {}) as Record<string, any>,
    secretFields: Object.keys((data?.secret_refs ?? {}) as Record<string, unknown>),
  };
}

export async function getSecret(companyId: string, key: IntegrationKey, field: string): Promise<string | null> {
  const { data } = await db().rpc("integration_secret", { p_company: companyId, p_key: key, p_field: field });
  return (data as string | null) ?? null;
}

/**
 * Real provider only when the integration passed its connection test and the MOCK_PROVIDERS
 * override is off. Everything else runs on the mock/manual path.
 */
export async function useReal(companyId: string, key: IntegrationKey): Promise<boolean> {
  if (MOCK_PROVIDERS()) return false;
  return (await getIntegration(companyId, key)).status === "connected";
}
