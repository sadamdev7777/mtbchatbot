import { describe, expect, it } from "vitest";
import { checkMetaFields } from "./integration-checks";

const TOKEN = "EAA" + "x".repeat(150);
describe("checkMetaFields", () => {
  it("accepts real-looking values", () => {
    expect(checkMetaFields({ waba_id: "123456789012345", phone_number_id: "109876543210987", token: TOKEN, app_secret: "0123456789abcdef0123456789abcdef" })).toEqual([]);
  });
  it("flags demo IDs, a token in the App Secret field and a non-token", () => {
    const p = checkMetaFields({ waba_id: "mock-waba-1", phone_number_id: "+60 12-345 6789", token: "token", app_secret: TOKEN });
    expect(p).toHaveLength(4);
    expect(p[3]).toMatch(/looks like the token/);
  });
  it("ignores empty fields (keep the saved value)", () => {
    expect(checkMetaFields({})).toEqual([]);
  });
});
