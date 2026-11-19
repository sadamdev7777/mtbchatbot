# MTB Inbox

AI-first WhatsApp customer platform for **Muslimtravelbug Sdn Bhd**, built on the official WhatsApp Business Platform (Meta Cloud API). Customers message one official number; Claude-powered agents (one per travel package, e.g. *Nura* for KK Kundasang) answer package questions, check live seats in TravelBoost, send seat-lock links and hand over to staff. Staff work in a shared inbox (desktop + phone PWA). A night job audits every chat, learns staff style and writes a morning report. Multi-tenant from day one (every table has `company_id` and RLS).

- **Backend:** Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions on Deno, pg_cron, Vault)
- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind v4, shadcn-style components, installable PWA with Web Push
- **AI:** Anthropic Claude via the official TypeScript SDK — Haiku 5.5 (router, judge), Sonnet 5.5 (agents, drafts, itineraries, receipts), Opus 5.5 (night job)

The interface is in English; everything customers receive is in Bahasa Melayu.

```
.
├── supabase/
│   ├── migrations/          schema, RLS, RPCs, cron (one file per area)
│   ├── seed.sql             MTB demo company (users per role, agents, knowledge, templates, scenarios)
│   ├── tests/               pgTAP: RLS per role, CRM, night job, reports
│   └── functions/           Edge Functions (index.ts = Deno.serve(handler), handler.ts = logic)
│       ├── _shared/         core rules (pure TS, shared with the web app), db, providers (real + mock), AI, jobs
│       ├── _dev/            serve.ts (all functions on one port for local dev) · loadtest.ts
│       └── wa-webhook · wa-send · ai-orchestrator · tb-webhook · templates-sync · followup-runner
│           bank-email-poller · night-job · itinerary-extract · integration-test · push-send
├── web/                     Next.js app (src/), Playwright e2e (e2e/)
├── docs/                    travelboost-api.openapi.yaml · operations.md (backups, monitoring, load)
├── design-reference/        the 30 HTML mockups the UI follows
├── DECISIONS.md             every judgement call, one line each
└── PROGRESS.md              milestone log and final summary
```

## 1. Run it locally

Requirements: Node 22, [Deno 2](https://deno.com), Docker, [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
supabase start
```

```bash
supabase db reset
```

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Fill `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `supabase/functions/.env` from `supabase status`, then start every Edge Function on one local port (54329):

```bash
npm run dev:fn
```

```bash
cp .env.example web/.env.local
```

Fill the keys in `web/.env.local`, then:

```bash
npm --prefix web install
```

```bash
npm --prefix web run build && npm --prefix web run start
```

Open http://127.0.0.1:3000. Seeded users (password `Password123!`):

| Email | Role | Lands on |
|---|---|---|
| sadam@mtb.test | Owner (2-step) | Dashboard |
| aisyah@mtb.test | Admin (2-step) | Dashboard |
| aqil@mtb.test | Team lead (Sabah) | Inbox |
| farah@mtb.test | Staff (Sabah) | Inbox |
| hakim@mtb.test | Staff (Overseas) | Inbox |
| nadia@mtb.test | Accounts | Payment verification |

2-step codes for owner/admin arrive in Mailpit at http://127.0.0.1:54324.

**Try it without any keys.** With `MOCK_PROVIDERS=true`, every integration uses its mock: a deterministic Malay-speaking mock model in place of Claude, a TravelBoost mock with KK Kundasang 2026–2027 (RM1,399–RM1,649, 1–16 seats) and Semporna (RM1,890) dates, a mock bank inbox and mock Meta. As the owner, open **/dev/simulator**, send *"Assalamualaikum, pakej Kundasang Mac 2027 untuk 2 orang"* and watch Nura answer in the Inbox (set Nura to **Auto** in AI Team first, or wait for out-of-office hours). Lock-seat links open a mock TravelBoost form; receipts can be sent as images with a caption like `Resit RM600 MTB-10234`; a mock bank email can be delivered from the simulator.

> In some sandboxes the Supabase Edge Runtime container cannot download npm packages (TLS-intercepting proxy). That is why local dev runs the same handlers on host Deno (`npm run dev:fn`). If Deno needs a custom CA, set `DENO_CERT=/path/to/ca.pem`.

### Checks

```bash
npm run check
```

That runs `deno check` + `deno lint` + Deno tests (core rules, webhook, gateway, orchestrator, scenarios, follow-ups, TravelBoost, payments, night job), `tsc` + ESLint + Vitest for the web app, and the pgTAP suites (`supabase test db`). End-to-end tests (they reset the local database and start the servers themselves):

```bash
npm run e2e
```

Webhook load test (500 messages in 60 s):

```bash
deno run -A --env-file=supabase/functions/.env supabase/functions/_dev/loadtest.ts 500 60
```

## 2. Environment variables

See `.env.example` (web + functions, every variable explained). Integration credentials are **not** environment variables: the owner enters them in **Settings › Integrations**; they are stored in Supabase Vault and only the last 4 characters are ever shown again.

| Where | Variable | Purpose |
|---|---|---|
| web | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project |
| web | `SUPABASE_SERVICE_ROLE_KEY` | server routes (invites, 2-step, simulator) — never exposed to the browser |
| web | `NEXT_PUBLIC_FUNCTIONS_URL` | `https://<ref>.supabase.co/functions/v1` in production |
| web | `SMTP_*` | fallback mail for 2-step codes and invites until the SMTP integration is connected |
| web | `MFA_CODE_SECRET`, `APP_URL`, `ERROR_WEBHOOK_URL`, `NEXT_PUBLIC_ENABLE_SIMULATOR` | see `.env.example` |
| functions | `INTERNAL_KEY` | shared secret for pg_cron calls (`x-internal-key`) |
| functions | `FUNCTIONS_PUBLIC_URL` | base URL shown for webhooks |
| functions | `MOCK_PROVIDERS` | `true` forces mocks (never in production) |
| functions | `META_GRAPH_VERSION`, `WA_MAX_SENDS_PER_SECOND`, `BROADCAST_BATCH_SIZE`, `ERROR_WEBHOOK_URL` | tuning / monitoring |

## 3. Deploy

> Moving the demo deployment to real data: see [docs/go-live/README.md](docs/go-live/README.md).
> Connecting WhatsApp without App Review: [docs/go-live/meta-app-review.md](docs/go-live/meta-app-review.md). Staff guide (Malay): [docs/staff-guide.md](docs/staff-guide.md).

### Supabase

1. Create a project (region Singapore), then link and push the schema:

   ```bash
   supabase link --project-ref <ref>
   ```

   ```bash
   supabase db push
   ```

2. Create the first company and owner. In the SQL editor, insert into `companies` (the `companies_init` trigger creates its integrations and automation rules), add a channel row, then invite the owner from Supabase Auth and insert a `members` row with `role = 'owner'`, `status = 'active'`. (`supabase/seed.sql` shows every table to fill; don't run the demo seed in production.)
3. Set Edge Function secrets and deploy the functions:

   ```bash
   supabase secrets set INTERNAL_KEY=<long random> FUNCTIONS_PUBLIC_URL=https://<ref>.supabase.co/functions/v1 META_GRAPH_VERSION=v24.0
   ```

   ```bash
   supabase functions deploy
   ```

   Each function uses the shared import map (`import_map = "./functions/deno.json"` in `supabase/config.toml`). `wa-webhook` and `tb-webhook` have `verify_jwt = false` (they verify Meta/TravelBoost signatures themselves), set in `supabase/config.toml`.
4. Turn on the schedules. pg_cron calls the functions through pg_net with two Vault secrets:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'edge_functions_url');
   select vault.create_secret('<the same INTERNAL_KEY>', 'edge_internal_key');
   select vault.create_secret('<the project anon key>', 'edge_anon_key'); -- passes the gateway's JWT check
   ```

   Schedules (already created by the migration): followup-runner and the AI sweeper every minute, templates-sync every 15 minutes, bank-email-poller every 5 minutes, night-job hourly from 00:00 to 06:00 Malaysia time.
5. Auth: in Authentication › URL configuration, set the Site URL to the Netlify URL and add `https://<site>/invite/accept` to the redirect URLs. Configure SMTP for Auth emails (invites).

### Netlify

1. New site from this repository. `netlify.toml` sets the base directory to `web`. Set *Functions region* (Site configuration › Build & deploy) to the same region as the Supabase project.
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_FUNCTIONS_URL`, `APP_URL`, `SMTP_*` (until the SMTP integration is connected), optional `ERROR_WEBHOOK_URL`. Leave `NEXT_PUBLIC_ENABLE_SIMULATOR` and `DEMO_MODE` unset in production.

**Demo deployment.** `MOCK_PROVIDERS=true` (function secret) + `NEXT_PUBLIC_ENABLE_SIMULATOR=true` + `DEMO_MODE=true` (Netlify) runs the whole system on mocks with the seed data; `DEMO_MODE` shows the owner/admin 2-step code on screen because the seeded `@mtb.test` mailboxes don't exist. Seed with a strong password (replace `Password123!` in `seed.sql`). Before connecting real keys: remove all three, reset the database (`supabase db reset --linked`) without the demo seed, and create the real owner.
3. Deploy: connect the repository for automatic builds, or deploy from your machine with the CLI (`cd web && netlify build && netlify deploy --no-build --prod --dir .netlify/static`). The PWA (manifest, service worker, offline page) is served from `web/public`.

## 4. Connect the integrations (Settings › Integrations)

Every integration shows what happens without it, the fields to fill, generated values with a Copy button, "How to get the keys" and **Test connection**. A feature switches to automatic only after its test passes; changing a key sets it back to *not connected* until the next passing test. Only the owner can change keys.

**Required, phase 1**

1. **Meta WhatsApp Cloud API**

   **Quickest: Connect with Facebook (Embedded Signup).** Needs a Meta App set up as a Tech Provider with a *Facebook Login for Business* configuration of type *WhatsApp Embedded Signup*. Fill in **Meta App ID**, **Embedded Signup configuration ID** and **App Secret**, Save, then click **Connect with Facebook** and pick the business, WhatsApp account and number. The server exchanges the code for the token (vault), subscribes the WABA to the webhook, registers the number and runs the test. Add the site's domain under *App settings › Basic › App domains* and *Facebook Login for Business › Allowed domains*. In demo mode (`MOCK_PROVIDERS=true`) the button opens a mock dialog instead.

   **Manual alternative:**
   1. Meta Business Manager › WhatsApp Manager: copy the *WhatsApp Business Account ID* and the *phone number ID*.
   2. Business Settings › Users › System users: create a system user, assign the app and the WABA (full control), and generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management` (add `ads_read` if you want to reuse it for Meta Ads).
   3. App dashboard › App settings › Basic: copy the **App Secret** (used to verify `X-Hub-Signature-256`).
   4. Paste all four into the panel and save.
   5. **Register the webhook**: App dashboard › WhatsApp › Configuration › Webhook › Edit. Callback URL = the *Webhook URL* from the panel (`https://<ref>.supabase.co/functions/v1/wa-webhook`), Verify token = the *Verify token* from the panel. Click *Verify and save*, then **subscribe to the `messages` field** (statuses arrive on the same field).
   6. Click **Test connection** (reads number quality and templates). Then Broadcast › Templates › *Sync with Meta*, and submit the 9 seeded Malay templates for approval.
2. **Outgoing email (SMTP)**: host, port, user, password, from address. Test sends nothing, it checks the login. Until connected, mail goes through the fallback SMTP (`SMTP_*` env vars).
3. **Web Push**: click *Generate keys* (VAPID), then Test. Each staff member turns on push in Settings › My notifications (iPhone: add MTB Inbox to the Home Screen first; the page explains how).

**Required, phase 2**

4. **Claude API**: API key from console.anthropic.com and a monthly cap in RM. Test checks the key without spending tokens. At the cap, agents switch to Assist with drafts off and the owner is notified.
5. **TravelBoost**: base URL, API key, webhook secret. TravelBoost must implement `docs/travelboost-api.openapi.yaml`. Register the panel's webhook URL (`…/tb-webhook?company=<id>`) for all events in TravelBoost. Test runs a product search.

**Optional**

6. **Bank notification email**: IMAP host/port, mailbox, app password and the **trusted sender** addresses (e.g. `alerts@maybank.com.my`). Read-only. Without it, accounts verifies every receipt.
7. **HRBoost**: base URL + API key; staff on approved leave today leave round-robin automatically.
8. **Meta Ads**: ad account ID (+ token with `ads_read`, or reuse the WhatsApp token) so the Router can pick ads by name.
9. **SleekFlow import**: export contacts as CSV from SleekFlow, then Contacts › Import CSV (only rows marked subscribed are opted in).

Finally: in **AI Team**, review Nura's knowledge, run the **Test bot**, and approve agents to go live (owner only, 25/25 scenarios). New agents go through **Hire new agent**.

## 5. Where things are

| Need | Look at |
|---|---|
| Business rules (window, quiet hours, router, auto-verify, follow-up stops) | `supabase/functions/_shared/core/rules.ts`, `time.ts` |
| The only path to Meta's send endpoint | `supabase/functions/wa-send/send.ts` (a test fails if anything else calls it) |
| Holder / re-check / needs-staff rules | `supabase/migrations/20261117000003_rpc.sql` |
| RLS per role | `supabase/migrations/20261117000002_rls.sql`, tests in `supabase/tests/` |
| AI prompt, tools, orchestrator, mock model | `supabase/functions/_shared/ai/` |
| Night job phases | `supabase/functions/night-job/phases.ts` |
| Payments | `supabase/functions/_shared/payments.ts` |
| Operations, backups, monitoring, load test results | `docs/operations.md` |
| Background job health (owner alert when cron calls fail) | `supabase/migrations/20261117000017_system_health.sql` |
