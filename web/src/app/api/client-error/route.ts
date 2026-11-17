import { json } from "@/lib/api";

/** Browser error reports (error boundaries) → server log + optional ERROR_WEBHOOK_URL. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const event = { level: "error", source: "web-client", at: new Date().toISOString(), message: String(body.message ?? "").slice(0, 500), digest: body.digest, path: String(body.path ?? "").slice(0, 200) };
  console.error(JSON.stringify(event));
  const url = process.env.ERROR_WEBHOOK_URL;
  if (url) await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) }).catch(() => {});
  return json({ ok: true });
}
