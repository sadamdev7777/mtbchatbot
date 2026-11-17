import { describe, expect, it } from "vitest";
import { canOpen, homeFor, navFor, SETTINGS_TABS } from "@/lib/roles";
import { isWindowOpen } from "@core/time.ts";
import { aiPrefix } from "@core/rules.ts";

describe("role routing", () => {
  it("redirects each role to its home after login", () => {
    expect(homeFor("owner")).toBe("/dashboard");
    expect(homeFor("admin")).toBe("/dashboard");
    expect(homeFor("staff")).toBe("/inbox");
    expect(homeFor("team_lead")).toBe("/inbox");
    expect(homeFor("accounts")).toBe("/payments");
  });

  it("matches the access matrix", () => {
    expect(canOpen("accounts", "inbox")).toBe(false);
    expect(canOpen("staff", "broadcast")).toBe(false);
    expect(canOpen("team_lead", "broadcast")).toBe(true);
    expect(canOpen("staff", "payments")).toBe(false);
    expect(canOpen("admin", "payments")).toBe(true);
  });

  it("shows 7 sidebar items plus payment verification for owner", () => {
    expect(navFor("owner").map((i) => i.label)).toEqual([
      "Dashboard", "Inbox", "Contacts", "Broadcast", "AI Team", "Morning report", "Payment verification", "Settings",
    ]);
    expect(navFor("admin")).toHaveLength(7);
    expect(navFor("accounts").map((i) => i.key)).toEqual(["payments", "settings"]);
  });

  it("limits settings tabs for non-admins to My notifications", () => {
    expect(SETTINGS_TABS.filter((t) => t.roles.includes("staff")).map((t) => t.key)).toEqual(["notifications"]);
  });

  it("shares core rules with Edge Functions", () => {
    expect(aiPrefix("Farah")).toBe("*Pembantu AI · Farah*");
    expect(isWindowOpen(new Date(Date.now() - 60_000))).toBe(true);
  });
});
