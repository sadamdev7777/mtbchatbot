import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against the local stack: `supabase start` + seed, functions on host Deno (54329),
 * and the production build of the web app (3000). Mock providers everywhere (MOCK_PROVIDERS=true).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 950 }, launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } },
  webServer: [
    {
      command: "cd .. && DENO_CERT=${DENO_CERT:-/root/.ccr/ca-bundle.crt} deno run -A --env-file=supabase/functions/.env supabase/functions/_dev/serve.ts",
      url: "http://127.0.0.1:54329/functions/v1/wa-webhook", reuseExistingServer: true, timeout: 120_000, ignoreHTTPSErrors: true,
    },
    { command: "npm run start -- -p 3000", url: "http://127.0.0.1:3000/login", reuseExistingServer: true, timeout: 120_000 },
  ],
});
