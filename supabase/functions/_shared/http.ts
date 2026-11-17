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

/** Wraps a handler with JSON error handling. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      await reportError(e, { fn: new URL(req.url).pathname.split("/").filter(Boolean).at(-1), method: req.method });
      return json({ error: "internal_error", message: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
}

/** Run work after the response when the runtime supports it (Supabase Edge Runtime), else await it. */
export function background(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = p.catch((e) => reportError(e, { fn: "background" }));
  if (rt?.waitUntil) rt.waitUntil(safe);
}
