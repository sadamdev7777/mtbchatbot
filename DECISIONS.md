# Decisions

One line each: decision — reason.

## Structure & tooling
- The repository root is the `mtb-inbox/` monorepo root (supabase/, web/, design-reference/, docs/) — the GitHub repo already exists with this name.
- Business rules that both Edge Functions and the web app need live as pure TypeScript in `supabase/functions/_shared/core/` and are imported by Next.js through the `@core/*` path alias — one implementation, tested by both Deno test and Vitest.
- Every Edge Function is `index.ts` (`Deno.serve(handler)`) + `handler.ts` (exported `handler`) — production runs index.ts on Supabase Edge Runtime; local dev/tests run all handlers on host Deno through `supabase/functions/_dev/serve.ts` (port 54329) because the Edge Runtime container in this build environment cannot fetch npm packages through the TLS-intercepting proxy.
- npm/jsr versions for Edge Functions are pinned in `supabase/functions/deno.json` — reproducible deploys.
- Next.js 16 with Cache Components turned off — every screen is per-user (RLS + Realtime), so request-time rendering is simpler and avoids Suspense/`use cache: private` plumbing on every session read.
- shadcn/ui-style components are written by hand in `web/src/components/ui` (cva + tailwind-merge) instead of the shadcn CLI — fewer moving parts, same look and API style.
- Inter is self-hosted through `@fontsource-variable/inter` — builds do not depend on reaching Google Fonts.
- Design tokens are copied from the mockups (`#0E7C66` brand, `#0B2B26` sidebar, …) into Tailwind v4 `@theme` variables in `globals.css`.

## Data & security
- One membership per auth user (`members.user_id` unique) — MTB is the only tenant now; multi-company membership can be added later without changing `company_id` on data.
- One conversation per (channel, contact); closing/reopening toggles its status — keeps history in one thread and makes "reopen when the customer writes" trivial.
- Inbox visibility: owner/admin all; team lead and staff see their teams' chats, chats with no team yet, and chats they hold; accounts has no inbox — matches the role table; `can_see_conversation()` is used by every inbox policy.
- Inbox writes (take over, assign, notes, labels, typing, close) go through security-definer RPCs that check the caller, not direct table writes — the holder/needs-staff rules stay atomic and in one place.
- 2-step verification is an emailed 6-digit code bound to the Supabase session id (`mfa_codes.session_id = jwt.session_id`); `auth_member_id()` returns nothing for an unverified owner/admin session, so RLS (not just the UI) blocks them — Supabase has no built-in email second factor.
- `companies.settings.require_2fa = false` exists only for local test data — production keeps the default true.
- Audit log (`events`) is written by triggers on conversations, labels, knowledge, members, team membership, integrations, agents, routing and company settings — nothing can change without a record.
- Integration secrets are stored with `vault.create_secret`; `integrations.secret_refs` keeps only the vault id and last 4 characters; only `set_integration_secret()` (owner) writes and only the service role reads (`integration_secret()`).
- Changing an integration's secret or config sets it back to `not_connected` — a feature goes automatic only after a new passing test.
- Storage: one private `media` bucket; object paths start with the company id and RLS checks that prefix.

## AI
- Claude pricing defaults (USD/MTok): Haiku 5.5 0.10/0.50, Sonnet 5.5 2/10, Opus 5.5 4/20; cache reads 0.1×, writes 1.25× input — first-party list prices; overridable per company.
- Official answers are matched with Postgres trigram similarity (pg_trgm) plus keyword overlap instead of embeddings — Anthropic has no embeddings endpoint and this avoids another vendor; good enough for short FAQ questions.

## Product details
- "Remember me" and "Log in with Google" from the login mockup are not built — the brief says email + password only, and Supabase sessions already persist.
- Payment verification appears in the sidebar for owner and accounts only (as the brief says); admins can still open it read-only by URL.

## WhatsApp
- A customer's first inbound message records `opt_in = true` with source `whatsapp_inbound`; STOP / "Jangan hantar lagi" sets `opted_out_at` and excludes them from broadcasts and marketing templates — the customer started the conversation with the business; opt-out is always honoured.
- Simulator signatures: wa-webhook accepts the simulator secret (`META_MOCK_APP_SECRET`) only while the company's Meta integration is not connected — the simulator cannot spoof a live number.
- Mock Meta fails sends to numbers ending in 999 (131026) so failure paths can be exercised by hand.
- Outbound media is sent to Meta as a 1-hour signed Storage URL (`link`) instead of uploading to Meta first — one request, no Meta media id bookkeeping.
- System messages (e.g. the opt-out confirmation) are prefixed `*Muslimtravelbug*` — every outbound message names who is speaking.
- Per-channel send limit is a fixed one-second window in Postgres (`take_send_token`, default 20/s) — shared by all function instances.
- Staff typing refreshes `staff_typing_until` at most every 30 s while typing (lock lasts 2 min).
- Local manual testing uses `next build && next start`; `next dev` HMR websockets do not work through this environment's proxy.
- ESLint: `no-explicit-any` off (JSON columns), `no-img-element` off (signed Storage URLs), `react-hooks/set-state-in-effect` off (async loaders set state after await).

## CRM
- Broadcast sending runs inside `followup-runner` (every minute) instead of a separate function — the brief fixes the function list; batches of 50 per tick by default (`BROADCAST_BATCH_SIZE`).
- Broadcast recipients are frozen when the broadcast starts (`materialize_broadcast`), and each recipient gets a conversation so the send still goes through `wa-send`.
- Imported contacts are not opted in unless the CSV has an opt-in column saying so — broadcasts must only reach people who agreed.
- Contact merge keeps the merged row as an alias (`merged_into_id`, number kept in `custom.other_numbers`) instead of deleting it — inbound messages from the old number still resolve and history is not lost.
- "Test to my number" uses a staff WhatsApp number stored on `members.phone`.
- The activity log lives at Settings › Activity log (owner/admin), linked from Staff & teams — the Settings tabs in the brief are fixed.
- `tb-webhook` is the TravelBoost gateway: signed webhooks from TravelBoost, plus authenticated lookups for the app (e.g. a contact's bookings) — keeps all TravelBoost traffic in one function.

## Notifications
- Push is triggered from Postgres (notification insert → pg_net → push-send) so every notification source (RPCs, functions, triggers) pushes without extra code; a sweep catches failures.
- While Web Push is not connected, notifications are marked handled and only the in-app sound/toast is used (the brief's manual mode).
- Personal push quiet hours live on `members.push_quiet_hours`; in-app notifications are never suppressed.

## Integrations
- Mock providers keep state in `public.mock_state` (service-role only) so seat locks, bookings, payments and the mock bank inbox survive across function invocations and e2e flows work without any keys.
- The mock TravelBoost seat-lock link opens a small form served by `tb-webhook` (`?mock_lock=`); submitting it creates the booking and emits `seat.locked` exactly like the real service would.
- TravelBoost webhooks identify the tenant with `?company=<id>` in the registered webhook URL (shown in the panel) and are verified with that company's webhook secret.
- Bank email without a connected integration is manual (accounts verifies everything); the mock inbox is used only when `MOCK_PROVIDERS=true`.
- Claude connection test uses `models.retrieve` (no tokens spent).
- `@anthropic-ai/sdk` pinned to 1.8.0 in deno.json: Deno refuses packages younger than 24 h by default, and 1.9.0 was published the day before.

## AI
- Manual tool loop on `client.beta.messages.create` instead of the SDK tool runner — the orchestrator needs control between tool calls and before sending (re-check), and the same loop must drive the mock model.
- Chat agents run Sonnet 5.5 with `output_config.effort: "low"` (chat replies; adaptive thinking is on by default); router and judge run Haiku 5.5; Sonnet/Opus calls include `fallbacks: "default"` (server-side refusal fallback); a final refusal hands the chat over.
- Cache layout: rules → company knowledge (breakpoint) → agent persona/mode/package/itinerary (breakpoint); per-turn context (time, contact, official answers) is a mid-conversation system message at the end so the cached prefix never changes between turns.
- Replies are split on lines containing only `---` (max 4 WhatsApp messages per turn).
- After a handover the holder becomes "none" and round-robin assigns staff; the AI then only writes drafts for that chat until "Return to bot".
- Agents in training only draft; resting agents are off.
- Close-sale follow-ups are (re)scheduled after every AI reply and cancelled by any customer reply (trigger on inbound).
- Inbound messages are ordered by our receive time; Meta's 1-second timestamp is kept in `meta.wa_timestamp` (equal timestamps broke transcript order).
- Knowledge activation runs the scenarios with the new text as an override for every live agent (company scope) or the owning agent; it only activates when all pass.
- `DISABLE_AI_AUTOTRIGGER` exists for Deno tests only, so tests drive the orchestrator deterministically.
- Word itineraries are converted to text (word/document.xml) before Claude reads them; PDFs and images go in as document/image blocks.
- An itinerary becomes agent knowledge section `itinerary_<product>` (markdown by day + staff clarifications), so it is versioned and rolled back like any other knowledge.
- Generated scenarios are stored per agent (`test_scenarios.agent_id`); company seed scenarios apply to every agent — 15 + 10 = the 25 required for go-live.
- After-sales steps send a free AI message while the 24-hour window is open and their approved template otherwise.
- `templates_sent` resets when a payment moves the chat to Deposit, so the after-trip review isn't blocked by close-sale templates.

## Night job
- One phase per cron hour (16:00–22:00 UTC = 00:00–06:00 MYT) so a slow Opus phase never blocks the next; each phase records its result in `night_reports.phases`.
- The report covers the Malaysia-time day that ended at midnight; runs between 00:00 and 06:59 belong to the previous day.
- Direct (auto-applied) changes are new knowledge versions with `source = night_job`; the 05:00 phase re-tests them and rolls them back on any scenario failure; owners can roll back from the report.
- Approving a suggestion goes through one SQL function (`rpc_decide_suggestion`) so the apply step and its audit trail are atomic.
- The WhatsApp morning report goes to `settings.owner_report_number` through `wa-send` like every other message.
