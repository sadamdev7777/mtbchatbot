import { assertEquals } from "@std/assert";
import { db } from "../_shared/db.ts";
import { COMPANY, loginJwt, testOpts } from "../_shared/testing.ts";
import { handler } from "./handler.ts";

async function setRequire2fa(on: boolean) {
  const { data } = await db().from("companies").select("settings").eq("id", COMPANY).single();
  await db().from("companies").update({ settings: { ...data!.settings, require_2fa: on } }).eq("id", COMPANY);
}

Deno.test("integration test failure is recorded and never turns a feature on", testOpts, async () => {
  await setRequire2fa(false);
  const jwt = await loginJwt("sadam@mtb.test");
  const r = await (await handler(new Request("http://x/integration-test", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify({ key: "claude" }) }))).json();
  assertEquals(r.ok, false);
  const { data } = await db().from("integrations").select("status, last_test_result").eq("company_id", COMPANY).eq("key", "claude").single();
  assertEquals(data!.status, "error");
  assertEquals(data!.last_test_result.message, "API key is required");
  const staff = await loginJwt("farah@mtb.test");
  const denied = await handler(new Request("http://x/integration-test", { method: "POST", headers: { authorization: `Bearer ${staff}` }, body: JSON.stringify({ key: "claude" }) }));
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
});

Deno.test("owner generates VAPID keys; private key goes to the vault", testOpts, async () => {
  const jwt = await loginJwt("sadam@mtb.test");
  const r = await (await handler(new Request("http://x/integration-test", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify({ action: "generate_vapid" }) }))).json();
  assertEquals(typeof r.public_key, "string");
  const { data } = await db().from("integrations").select("config, secret_refs").eq("company_id", COMPANY).eq("key", "web_push").single();
  assertEquals(data!.config.public_key, r.public_key);
  assertEquals(typeof data!.secret_refs.private_key.id, "string");
  const ok = await (await handler(new Request("http://x/integration-test", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify({ key: "web_push" }) }))).json();
  assertEquals(ok.ok, true);
  await setRequire2fa(true);
});

Deno.test("Connect with Facebook (demo): mock signup connects WhatsApp, token in the vault; owner only", testOpts, async () => {
  const call = async (jwt: string, body: unknown) => await handler(new Request("http://x/integration-test", { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }));
  await setRequire2fa(false);
  const owner = await loginJwt("sadam@mtb.test");
  const info = await (await call(owner, { action: "meta_signup_info" })).json();
  assertEquals(info.mock, true);
  const admin = await loginJwt("aisyah@mtb.test");
  const denied = await call(admin, { action: "meta_embedded_signup", code: "mock-code" });
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
  const bad = await call(owner, { action: "meta_embedded_signup", code: "AQB-real-looking" });
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
  const r = await (await call(owner, { action: "meta_embedded_signup", code: "mock-code", waba_id: "mock-waba-1", phone_number_id: "mock-phone-1" })).json();
  assertEquals(r.ok, true);
  const { data } = await db().from("integrations").select("status, config, secret_refs").eq("company_id", COMPANY).eq("key", "meta_whatsapp").single();
  assertEquals(data!.status, "connected");
  assertEquals(data!.config.phone_number_id, "mock-phone-1");
  assertEquals(data!.config.connected_via, "embedded_signup");
  assertEquals(typeof data!.secret_refs.token.last4, "string");
  const { data: ch } = await db().from("channels").select("phone_number_id").eq("company_id", COMPANY).order("created_at").limit(1).single();
  assertEquals(ch!.phone_number_id, "mock-phone-1");
  await db().from("integrations").update({ status: "not_connected" }).eq("company_id", COMPANY).eq("key", "meta_whatsapp");
  await setRequire2fa(true);
});
