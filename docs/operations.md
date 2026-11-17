# Operations: backups, monitoring, limits

## Backups
- **Database**: use a Supabase plan with daily backups and enable **Point-in-Time Recovery** (PITR, Pro plan add-on) so any moment in the last 7 days can be restored. Test a restore into a branch project once per quarter.
- **Off-site copy**: run nightly from CI (or any server with the Supabase CLI):
  ```bash
  supabase db dump --db-url "$PROD_DB_URL" -f "backup-$(date +%F).sql" --data-only
  ```
  Keep 30 days in an S3/R2 bucket with object lock. Schema lives in `supabase/migrations/`, so a data-only dump plus the migrations rebuilds everything.
- **Storage** (`media` bucket: chat media, receipts, itineraries): mirror nightly with `rclone sync` against the Supabase S3 endpoint (Storage › S3 connection) to the same off-site bucket.
- **Vault secrets** are included in database backups (encrypted with the project's key). After restoring into a *different* project, re-enter the integration secrets in Settings › Integrations.
- **What is not backed up here**: WhatsApp message history on Meta's side (not retrievable via API) and TravelBoost data (its own backups).

## Monitoring
- Edge Functions log structured JSON errors (`level: "error"`) to Supabase logs; set `ERROR_WEBHOOK_URL` (Edge Function secret) to also POST every error to Sentry/Slack/any collector.
- The web app reports server errors through Next.js `onRequestError` (`src/instrumentation.ts`) and browser errors from error boundaries through `/api/client-error`; same `ERROR_WEBHOOK_URL` (Netlify env var).
- Watch in Supabase logs: `wa-send` failures (error codes on messages), `night-job` phase failures (also visible on Morning report › Night job), `bank-email-poller` errors.
- Number quality drops notify owners/admins automatically (templates-sync every 15 min).

## Limits and load
- Webhook load test: `deno run -A --env-file=supabase/functions/.env supabase/functions/_dev/loadtest.ts 500 60` — 500 messages in a minute, then 10 % duplicates. Last local run: 500/500 OK, p50 26 ms, p95 39 ms, max 109 ms, duplicates ignored, exactly-once storage; every chat answered by the AI.
- Meta sends are limited per number (`WA_MAX_SENDS_PER_SECOND`, default 20/s, shared across function instances through Postgres) and retried with backoff on Meta throughput errors (130429, 131056).
- Broadcasts go out in batches (`BROADCAST_BATCH_SIZE`, default 50 per minute) to protect number quality.
- Claude spend is capped per month (Settings › Integrations › Claude).
