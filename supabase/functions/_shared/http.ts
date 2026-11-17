import { userDb } from "./db.ts";
import { INTERNAL_KEY, SERVICE_ROLE_KEY } from "./env.ts";
import { reportError } from "./monitoring.ts";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export interface Member {
  member_id: string;
  company_id: string;
  role: "owner" | "admin" | "team_lead" | "staff" | "accounts";
  display_name: string;
  email: string;
}

export type Caller = { kind: "service" } | { kind: "user"; jwt: string; me: Member };

/** Service callers send the service role key (Bearer) or x-internal-key; users send their Supabase JWT. */
export async function getCaller(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const internal = req.headers.get("x-internal-key");
  if ((INTERNAL_KEY() && internal === INTERNAL_KEY()) || (token && token === SERVICE_ROLE_KEY())) return { kind: "service" };
  if (!token) throw new HttpError(401, "unauthorized");
  const { data, error } = await userDb(token).rpc("rpc_me");
  if (error || !data) throw new HttpError(401, "unauthorized", "Not signed in or 2-step not completed");
  return { kind: "user", jwt: token, me: data as Member };
}

export function requireRole(c: Caller, roles: Member["role"][]): void {
  if (c.kind === "service") return;
  if (!roles.includes(c.me.role)) throw new HttpError(403, "forbidden");
}

/** CORS for browser calls (the web app calls functions with the user's Bearer token; no cookies). */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/** Wraps a handler with CORS (incl. the OPTIONS preflight) and JSON error handling. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      return withCors(await fn(req));
    } catch (e) {
      if (e instanceof HttpError) return withCors(json({ error: e.code, message: e.message }, e.status));
      await reportError(e, { fn: new URL(req.url).pathname.split("/").filter(Boolean).at(-1), method: req.method });
      return withCors(json({ error: "internal_error", message: e instanceof Error ? e.message : String(e) }, 500));
    }
  };
}

/** Run work after the response when the runtime supports it (Supabase Edge Runtime), else await it. */
export function background(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = p.catch((e) => reportError(e, { fn: "background" }));
  if (rt?.waitUntil) rt.waitUntil(safe);
}
