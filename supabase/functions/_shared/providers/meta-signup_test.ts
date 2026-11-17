import { assert, assertEquals, assertRejects } from "@std/assert";
import { completeEmbeddedSignup, newPin } from "./meta-signup.ts";

function fakeGraph(opts: { platform?: string; registerFails?: boolean } = {}) {
  const calls: { method: string; url: string; body?: string; auth?: string | null }[] = [];
  const f = ((input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body as string | undefined, auth: new Headers(init.headers).get("authorization") });
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
    if (url.includes("/oauth/access_token")) return ok({ access_token: "EAAG-business-token" });
    if (url.endsWith("/subscribed_apps")) return ok({ success: true });
    if (url.includes("?fields=")) return ok({ display_phone_number: "+60 3-2788 0000", verified_name: "Muslimtravelbug", platform_type: opts.platform ?? "NOT_APPLICABLE" });
    if (url.endsWith("/register")) return opts.registerFails ? Promise.resolve(new Response(JSON.stringify({ error: { message: "PIN mismatch", code: 133005 } }), { status: 400 })) : ok({ success: true });
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;
  return { f, calls };
}

const input = { appId: "111", appSecret: "shh", code: "AQB-code", wabaId: "222", phoneNumberId: "333", pin: "123456", version: "v24.0" };

Deno.test("embedded signup: exchanges the code, subscribes the WABA, registers the number", async () => {
  const { f, calls } = fakeGraph();
  const r = await completeEmbeddedSignup(input, f);
  assertEquals(r.token, "EAAG-business-token");
  assertEquals(r.displayPhone, "+60 3-2788 0000");
  assertEquals(r.registered, true);
  assertEquals(r.warnings, []);
  assert(calls[0].url.includes("client_secret=shh") && calls[0].url.includes("code=AQB-code"));
  assertEquals(calls[1], { method: "POST", url: "https://graph.facebook.com/v24.0/222/subscribed_apps", body: undefined, auth: "Bearer EAAG-business-token" });
  assertEquals(JSON.parse(calls[3].body!), { messaging_product: "whatsapp", pin: "123456" });
});

Deno.test("embedded signup: already on Cloud API skips registration; failed registration is a warning", async () => {
  const a = fakeGraph({ platform: "CLOUD_API" });
  const r1 = await completeEmbeddedSignup(input, a.f);
  assertEquals(r1.registered, true);
  assert(!a.calls.some((c) => c.url.endsWith("/register")));
  const b = fakeGraph({ registerFails: true });
  const r2 = await completeEmbeddedSignup(input, b.f);
  assertEquals(r2.registered, false);
  assert(r2.warnings[0].includes("PIN mismatch"));
});

Deno.test("embedded signup: rejects missing ids and keeps PINs at 6 digits", async () => {
  await assertRejects(() => completeEmbeddedSignup({ ...input, wabaId: "" }, fakeGraph().f));
  for (let i = 0; i < 20; i++) assert(/^\d{6}$/.test(newPin()));
});
