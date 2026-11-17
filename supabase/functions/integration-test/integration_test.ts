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
