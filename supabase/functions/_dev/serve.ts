// Local dev/test server for all Edge Functions on host Deno (same handlers as production).
// Production runs each function on Supabase Edge Runtime via its own index.ts.
//   deno run -A --env-file=supabase/functions/.env supabase/functions/_dev/serve.ts
const PORT = Number(Deno.env.get("FUNCTIONS_DEV_PORT") ?? 54329);
const FUNCTIONS = [
  "wa-webhook", "wa-send", "ai-orchestrator", "tb-webhook", "templates-sync", "followup-runner",
  "bank-email-poller", "night-job", "itinerary-extract", "integration-test", "push-send",
];

type Handler = (req: Request) => Response | Promise<Response>;
const cache = new Map<string, Handler>();

async function load(name: string): Promise<Handler> {
  if (!cache.has(name)) {
    const mod = await import(new URL(`../${name}/handler.ts`, import.meta.url).href);
    cache.set(name, mod.handler as Handler);
  }
  return cache.get(name)!;
}

// No CORS here on purpose: like hosted Supabase, each function answers CORS itself (shared handle()),
// so local runs and e2e tests catch a function that doesn't.
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  const name = url.pathname.replace(/^\/functions\/v1\//, "").replace(/^\//, "").split("/")[0];
  if (!FUNCTIONS.includes(name)) return new Response(JSON.stringify({ error: "unknown function", name }), { status: 404 });
  try {
    return await (await load(name))(req);
  } catch (e) {
    console.error(name, e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
console.log(`functions dev server on http://127.0.0.1:${PORT}/functions/v1/<name>`);
