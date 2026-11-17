import type { Instrumentation } from "next";

/** Server-side error hook: structured log + optional ERROR_WEBHOOK_URL (Sentry/Slack/any collector). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  const event = { level: "error", source: "web-server", at: new Date().toISOString(), message: e.message, digest: e.digest, path: request.path, method: request.method, route: context.routePath, kind: context.routerKind };
  console.error(JSON.stringify(event));
  const url = process.env.ERROR_WEBHOOK_URL;
  if (url) await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) }).catch(() => {});
};
