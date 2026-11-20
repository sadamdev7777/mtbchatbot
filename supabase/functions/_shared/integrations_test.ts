import { assert } from "@std/assert";
import { realAllowed } from "./integrations.ts";

Deno.test("REAL_PROVIDERS lets one integration run for real while the rest stay mocked", () => {
  assert(realAllowed("claude", false, []), "no mock override: real");
  assert(!realAllowed("claude", true, []), "mock override: mocked");
  assert(realAllowed("meta_whatsapp", true, ["meta_whatsapp"]), "listed: real");
  assert(!realAllowed("claude", true, ["meta_whatsapp"]), "not listed: mocked");
});
