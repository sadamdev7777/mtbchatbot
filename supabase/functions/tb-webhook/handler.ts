export function handler(_req: Request): Response {
  return new Response(JSON.stringify({ error: "not_implemented" }), { status: 501 });
}
