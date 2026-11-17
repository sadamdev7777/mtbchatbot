// Error monitoring hook for Edge Functions. Always logs structured JSON (Supabase log explorer);
// when ERROR_WEBHOOK_URL is set, also POSTs the event (works with Sentry/Slack/any HTTP collector).
export interface ErrorContext { fn?: string; action?: string; companyId?: string; [k: string]: unknown }

export async function reportError(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  const event = { level: "error", at: new Date().toISOString(), message: e.message, stack: e.stack?.split("\n").slice(0, 8).join("\n"), ...ctx };
  console.error(JSON.stringify(event));
  const url = Deno.env.get("ERROR_WEBHOOK_URL");
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "edge-function", ...event }), signal: AbortSignal.timeout(3000) });
  } catch {
    // never let monitoring break the request
  }
}
