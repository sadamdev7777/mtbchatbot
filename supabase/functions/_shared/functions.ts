import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./env.ts";

/** Base URL other functions are reached at from inside a function (dev router locally). */
export function functionsInternalUrl(): string {
  return Deno.env.get("FUNCTIONS_INTERNAL_URL") ?? `${SUPABASE_URL()}/functions/v1`;
}

/** Call another Edge Function as the service. */
export async function invokeFunction<T = any>(name: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${functionsInternalUrl()}/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_ROLE_KEY()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as T };
}

export interface SendRequest {
  conversation_id: string;
  kind: "text" | "template" | "interactive" | "media";
  body?: string;
  template?: { name: string; language?: string; params?: string[]; header_params?: string[] };
  interactive?: { body: string; buttons: { id: string; title: string }[] };
  media?: { path: string; mime: string; filename?: string; caption?: string };
  sender_type: "staff" | "ai" | "system";
  agent_id?: string | null;
  ai_run_id?: string | null;
  purpose?: "reply" | "followup" | "aftersales" | "broadcast" | "system" | "router";
  broadcast_recipient_id?: string | null;
  meta?: Record<string, unknown>;
}

/** Every outbound WhatsApp message goes through the wa-send gateway. */
export function sendViaGateway(req: SendRequest) {
  return invokeFunction<{ ok: boolean; message_id?: string; error?: string; message?: string }>("wa-send", req);
}
