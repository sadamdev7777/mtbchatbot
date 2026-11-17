import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const PAGES = [
  "/dashboard", "/dashboard/reports", "/inbox?tab=all&c=70000000-0000-0000-0000-000000000001", "/contacts", "/contacts/60000000-0000-0000-0000-000000000001",
  "/broadcast", "/broadcast/templates", "/ai", "/ai/agents/50000000-0000-0000-0000-000000000001", "/ai/knowledge", "/ai/test", "/ai/router", "/ai/new",
  "/morning-report", "/morning-report/night-job", "/payments", "/settings/staff", "/settings/labels", "/settings/integrations", "/settings/automation",
  "/settings/notifications", "/settings/channel", "/notifications", "/dev/simulator",
];

async function audit(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path} · ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test("login page has no serious accessibility violations", async ({ page }) => {
  expect(await audit(page, "/login")).toEqual([]);
});

test("main screens have no serious accessibility violations (WCAG 2 AA)", async ({ page }) => {
  await login(page, "sadam@mtb.test");
  const all: string[] = [];
  for (const p of PAGES) all.push(...(await audit(page, p)));
  expect(all).toEqual([]);
});

test("phone inbox has no serious accessibility violations", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, "farah@mtb.test");
  expect([...(await audit(page, "/inbox?tab=needs")), ...(await audit(page, "/inbox?c=70000000-0000-0000-0000-000000000001"))]).toEqual([]);
});
