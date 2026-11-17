import { assertEquals } from "@std/assert";
import { handle, HttpError, json } from "./http.ts";

Deno.test("handle: answers the CORS preflight without running the handler", async () => {
  let ran = false;
  const h = handle(() => { ran = true; return Promise.resolve(json({ ok: true })); });
  const res = await h(new Request("http://x/fn", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals(ran, false);
});

Deno.test("handle: CORS headers on success and on errors", async () => {
  const ok = await handle(() => Promise.resolve(json({ ok: true })))(new Request("http://x/fn", { method: "POST" }));
  assertEquals(ok.headers.get("access-control-allow-origin"), "*");
  const err = await handle(() => Promise.reject(new HttpError(401, "unauthorized")))(new Request("http://x/fn", { method: "POST" }));
  assertEquals(err.status, 401);
  assertEquals(err.headers.get("access-control-allow-origin"), "*");
  await err.body?.cancel(); await ok.body?.cancel();
});
