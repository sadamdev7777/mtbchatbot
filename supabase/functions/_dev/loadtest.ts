// Webhook load test: N signed inbound messages spread over D seconds against wa-webhook, then
// duplicates of 10% of them. Reports latency percentiles and checks exactly-once storage.
//   deno run -A --env-file=supabase/functions/.env supabase/functions/_dev/loadtest.ts [count] [seconds]
import { createClient } from "@supabase/supabase-js";
import { hmacSha256Hex } from "../_shared/crypto.ts";

const N = Number(Deno.args[0] ?? 500), SECONDS = Number(Deno.args[1] ?? 60);
const URL_ = Deno.env.get("LOADTEST_URL") ?? "http://127.0.0.1:54329/functions/v1/wa-webhook";
const secret = Deno.env.get("META_MOCK_APP_SECRET") ?? "mock-app-secret";
const run = crypto.randomUUID().slice(0, 8);

function payload(i: number) {
  const from = "6015" + String(10_000_000 + i).slice(-8);
  return JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "load", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: "mock-phone-1" }, contacts: [{ wa_id: from, profile: { name: `Load ${i}` } }],
    messages: [{ from, id: `wamid.load.${run}.${i}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: `Load test ${i}: pakej Kundasang Mac 2027 2 orang` } }],
  } }] }] });
}

async function send(body: string) {
  const t = performance.now();
  const r = await fetch(URL_, { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${await hmacSha256Hex(secret, body)}` } });
  await r.body?.cancel();
  return { status: r.status, ms: performance.now() - t };
}

const bodies = Array.from({ length: N }, (_, i) => payload(i));
const results: { status: number; ms: number }[] = [];
const started = performance.now();
const inflight: Promise<void>[] = [];
for (let i = 0; i < N; i++) {
  const due = started + (i * SECONDS * 1000) / N;
  const wait = due - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  inflight.push(send(bodies[i]).then((x) => { results.push(x); }));
}
await Promise.all(inflight);
const dupes = await Promise.all(bodies.slice(0, Math.ceil(N / 10)).map(send));
const elapsed = (performance.now() - started) / 1000;

const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))].toFixed(0);
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const { count } = await db.from("messages").select("id", { count: "exact", head: true }).like("wa_message_id", `wamid.load.${run}.%`);
console.log(JSON.stringify({
  sent: N, seconds: Number(elapsed.toFixed(1)), rate_per_min: Math.round((N / elapsed) * 60),
  ok: results.filter((r) => r.status === 200).length, errors: results.filter((r) => r.status !== 200).length,
  p50_ms: Number(pct(50)), p95_ms: Number(pct(95)), max_ms: Number(ms.at(-1)!.toFixed(0)),
  duplicates_sent: dupes.length, duplicates_ok: dupes.filter((d) => d.status === 200).length, stored_messages: count, exactly_once: count === N,
}, null, 2));
