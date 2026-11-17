# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Foundation | ✅ done |
| 2 | WhatsApp core + Inbox | ✅ done |
| 3 | Contacts, labels, broadcast, templates, automation, activity log | ✅ done |
| 4 | Notifications and phone | ✅ done |
| 5 | Integrations panel | ✅ done |
| 6 | AI core | ✅ done |
| 7 | AI extras | ✅ done |
| 8 | Night job and morning report | ✅ done |
| 9 | Payment verification | ✅ done |
| 10 | Dashboard and reports | ✅ done |
| 11 | Hardening | ✅ done |
| 12 | Docs | ⏳ |

## Milestone 1 — Foundation
- Supabase project config, migrations for the whole data model (`supabase/migrations/2026111700000{1..4}`), RLS on every table.
- pgTAP RLS tests per role (`supabase/tests/rls_roles.test.sql`, 32 assertions): owner/admin need 2-step, team lead/staff team scoping, accounts isolation, internal functions locked to the service role, holder and re-check rules.
- Seed: MTB company, 6 users (one per role, password `Password123!`), 3 teams, channel, labels, agents Nura and Sari, company + package knowledge, official answers, router rules, follow-up and after-sales defaults, 9 Malay template drafts, 10 test scenarios, demo chats.
- Shared core rules (`_shared/core`) with Deno tests: 24-hour window, quiet hours, office hours, work mode, identity prefixes, 8-row cap, banned words, router, payment auto-verify, follow-up stop rules, cost.
- Next.js app shell: login, emailed 2-step code for owner/admin, invite + accept, role-based redirect, sidebar with badges, sub-tabs, mobile bottom nav, notification bell, design tokens from the mockups.

## Milestone 2 — WhatsApp core + Inbox
- `wa-webhook`: Meta GET handshake, X-Hub-Signature-256 check (App Secret, or simulator secret while Meta is not connected), idempotent inbound (unique wa_message_id), contacts/conversations upsert, Click-to-WhatsApp referral + Source label, media download to Storage, statuses (forward-only; 131047 → red message + Needs staff), STOP opt-out with Malay confirmation, notifications to the holder, hand-off to the AI orchestrator.
- `wa-send`: the only path to Meta's send endpoint (enforced by a test that scans the code). 24-hour window check before calling Meta, approved-template check, marketing opt-out, identity prefixes, staff send = take over (second staff gets 409), per-channel rate limit, failure handling.
- `templates-sync`: Meta sync, submit, "used by" recompute, delete blocked when in use, number quality alerts. Mock Meta approves submitted templates on the next sync.
- Inbox (desktop + responsive): tabs Mine/Team/Needs staff/Unassigned/All with counts, filters (number, label, stage, agent, closed), realtime list and thread, header with 24-hour countdown, owner and presence, Take over / Return to bot / Assign / Close / Reopen, notes with @mentions, quick replies, attachments, template picker when the window is closed, AI draft card (use/rewrite/discard recorded), second-staff lock, customer panel with stage, needs-staff timer and grouped labels.
- Dev simulator (`/dev/simulator`): customer-side phone that posts signed webhooks and statuses.
- Tests: 10 Deno integration tests (webhook + gateway) on top of the core tests.

## Milestone 3 — Contacts, labels, broadcast, templates, automation, activity log
- Contacts: filters (stage, destination, temperature, source, owner, search), pagination, bulk assign / add label / add to broadcast / export, CSV import (SleekFlow export or generic; no opt-in assumed unless the file says so), add contact, duplicate detection (same name + email, different numbers) with merge, profile page (details, opt-in, timeline, TravelBoost bookings + passports, notes).
- Labels settings: groups with rules, "how it's set", active-chat counts, admin-only create/edit, 60-day unused warning.
- Broadcast: segment (stage, destination, labels, last chat, picked contacts) with live count of opted-in recipients, approved template with variable mapping, hand-over agent on reply, send now / schedule / draft, test to my number, estimated Meta cost, batches that respect quiet hours, per-broadcast sent/read/replied/failed.
- Templates: list with status, rejection reason, "used by"; create with [placeholders] → {{n}}, quick-reply buttons and examples; submit to Meta; sync; delete blocked while in use; team leads can suggest.
- Automation: round-robin (online, fewest open chats, skips leave), leave reassignment, staff-not-replying reminders (staff, then team lead), close old chats, HOT→WARM decay; settings screen with toggles and parameters. (Out-of-hours auto message runs in the AI orchestrator, milestone 6.)
- Staff & teams: invite, roles (owner-only for admin roles), deactivate, manual leave, WhatsApp number for test sends, team management, role matrix. Activity log with filter and CSV export.
- New companies get integration rows and default automation rules from a trigger (multi-tenant ready).
- Tests: pgTAP merge/segment/round-robin; Deno broadcast runner (opt-in only, quiet hours, batching) and reminders/auto-close; Vitest CSV import + template builder.

## Milestone 4 — Notifications and phone
- PWA: manifest, icons, service worker (offline page, push display, click-to-open), installable; iOS "Add to Home Screen" guidance shown before push.
- Web Push (VAPID) via `push-send`: called by a trigger on every notification (plus a sweep), honours per-event push prefs and personal quiet hours, removes dead subscriptions; browser sound only while Web Push isn't connected.
- One realtime notification provider: feed, unread badge, sound per event preference, toasts, and an in-app alert when a visible chat newly needs staff.
- My notifications: sound/push per event (all 8 events from the brief), push on/off per device, test sound, personal quiet hours.
- Phone: bottom navigation (Inbox, Contacts, Dashboard, Notifications), Needs-staff alert at the top of the chat list, compact chat header with a large Take over button, AI draft card, 44 px touch targets (buttons, toasts, list rows).

## Milestone 5 — Integrations panel
- Settings › Integrations grouped as Required phase 1 / phase 2 / Optional: status, what happens without/with it, fields with masked secrets (last 4 only, owner-only writes, Vault storage), generated values with Copy (webhook URLs, verify token, VAPID public key), "How to get the keys", Test connection.
- `integration-test`: real connection tests for Meta WhatsApp, SMTP, Web Push, Claude, TravelBoost, bank IMAP, HRBoost, Meta Ads; results recorded; a feature only goes automatic after a pass; changing a secret/config resets to not connected. VAPID key generation (owner).
- Providers with real + mock implementations selected per company (`useReal`: connected and `MOCK_PROVIDERS` not set): Meta, TravelBoost (full client + stateful mock with KK Kundasang 2026–2027 RM1,399–1,649 / 1–16 seats and Semporna RM1,890), bank IMAP, HRBoost, Meta Ads, SMTP, Claude.
- `tb-webhook`: HMAC-signed TravelBoost events processed exactly once (seat.locked → booking stage + Needs staff "send payment link" + round-robin; seat.lock_expired → `seat_dilepaskan_v1`; payment.recorded → Deposit/Full payment + after-sales schedule; booking.cancelled → Lost; availability.low / product.dates_added → event follow-ups), the mock seat-lock form, and contact booking lookups for the profile page.
- HRBoost leave feeds the leave automation; dashboard "System setup" card.
- Tests: TravelBoost mock catalogue and 8-row search; tb-webhook signature/idempotency/stage flow; integration-test failure recording and VAPID generation.

## Milestone 6 — AI core
- Claude client via the official SDK (beta Messages API with server-side refusal fallback for Sonnet/Opus), prompt caching on company knowledge and agent blocks, per-run cost (USD) and monthly spend (RM) with the cap: at the cap agents stop (drafts off too) and the owner is notified once.
- Deterministic mock model (same tool protocol) so the AI team, scenarios and e2e run without a key.
- Router: ad referral → keywords → Haiku classification when inconclusive → destination buttons → fallback team; out-of-hours automation for team routes; round-robin.
- Agents: work modes (follow schedule / auto / assist / off), training/resting status, close-sale and after-sales modes by stage, debounce (8 s), claim to avoid double runs, rule 4 re-check before every message (newer customer message → re-run; staff typing/sent → discard), sweep for lost runs.
- Tools (strict schemas): search_products (≤8 rows, enough seats first), get_package_info, get_official_answer (pg_trgm), create_seat_lock_link, get_booking / check_payment (only the customer's own bookings), handover_to_staff, set_label, schedule_followup, send_itinerary_pdf.
- Handover: polite Malay reply, Needs staff with reason, AI summary note, team round-robin. Assist mode: AI draft with seat data in the inbox; rewrite shorter; use/edit/discard recorded.
- Identity prefixes, Malay replies, business-only and honesty rules in the prompt; tool lines in the chat.
- AI Team screens: agent cards, profile tabs (Profile with work mode and name shown to customer, Knowledge, Close sale, After-sales, Follow-up, Performance), company knowledge with versions (save draft → activate after scenarios pass → roll back), official answers, Router editor.
- Scenario runner (deterministic checks + Claude judge) used before knowledge activation; all 10 seed scenarios pass for Nura on the mock model.
- Tests: orchestrator (routing, auto reply, debounce, handover, honesty/scope, drafts, ask buttons, spend cap), scenario checks.

## Milestone 7 — AI extras
- Itinerary upload (PDF, Word, images) → `itinerary-extract` (Sonnet with document/image input, structured JSON: days, included/not included, free & easy, questions with why + options) → batched questions with quick-answer buttons, send to another staff member (notification + "Questions for you" page) → activation blocked until all answered, runs the agent's scenarios with the new itinerary, then creates and activates a new knowledge version (old itinerary archived).
- New agent wizard (5 steps): package (TravelBoost product check), name & avatar, knowledge (package text, itinerary, past chats → official-answer drafts to approve), test (15 generated + 10 company scenarios = 25), owner-only approval that requires 25/25 (enforced in SQL) with a starting mode.
- Test bot: sandbox chat against live or draft knowledge (no WhatsApp, no seat locks), "what the bot saw" panel (knowledge versions, official answers, tools, dates shown, reply time, handover, labels, model/cost), saved scenarios with Run all.
- Follow-up engine in `followup-runner`: close-sale sequence (3 h / 20 h free AI messages, 3-day and 10-day templates), seat-locked reminders, after-trip review, after-sales schedule (on deposit, 60/50/45/7 days; template when the window is closed; unpaid balance at 45 days → Needs staff), event follow-ups from TravelBoost, trips marked done. Stop rules: customer replied, not interested / "Tak jadi" (lost reason stored, COLD), 2-template cap, staff holds (reminder instead), quiet hours (wait), opted out, free messages only inside the window.
- Tests: itinerary extract → questions → activation; 25/25 go-live scenarios on the mock; follow-up sending and every stop rule.

## Milestone 8 — Night job and morning report
- `night-job` runs hourly 00:00–06:00 MYT via pg_cron (one phase per hour, Opus in real mode): audit every bot chat of the day (price without booking ask per AI turn, unanswered questions, invented facts, wrong seat claims, style breaks, failed messages); learn staff style (applied directly by default as a new knowledge version); compare deposit vs non-deposit chats; propose official answers from real staff answers + collect questions for the owner; audit needs-staff leads untouched 12 h+, teams with < 2 active staff, coaching notes to team leads, unused labels; run all scenarios against proposed knowledge changes and drop/roll back failures; write the report and send `laporan_pagi_v1` to the owner + in-app notification.
- Permissions per area (style / official answers / rules / reassigning / coaching) on the Night job tab; owner can run all phases on demand.
- Morning report screen: summary counts, insights, suggestions with Approve / Edit / Reject, Roll back for direct changes, "Questions that need your answer" → official answer.
- Tests: phase schedule/window, a full night run on the mock (audit finding, style applied, report sent), pgTAP for decisions/rollback/permissions.

## Milestone 9 — Payment verification
- Receipt in chat (image/PDF in a chat with a booking) → `bank-email-poller` reads it (Claude vision: amount, date, reference, sender, bank, signs of editing, opinion) → `payment_verification` with the TravelBoost invoice amount and lead guest; accounts notified when it can't auto-verify.
- Bank email poller (every 5 min, IMAP read-only, idempotent by message id): parses Malaysian bank alerts, auto-verifies only when amount matches exactly, date within 3 days, reference has the booking number or the sender matches the lead guest, the sender address is trusted, and the receipt doesn't look edited.
- On verification: payment recorded in TravelBoost, stage → Deposit / Full payment (agent switches to after-sales, schedule queued), official Malay receipt message, event logged. Ask customer / Reject send a Malay message (reject also flags Needs staff).
- Payment verification screen: stats, receipt image, invoice vs receipt vs bank email with mismatches highlighted, AI opinion, Verify / Ask customer / Reject (owner + accounts; admin view-only), last 7 days, rules, email source.
- Simulator: deliver a mock bank email and poll.
- Tests: bank alert parsing; receipt + bank email → auto-verified end to end (TravelBoost paid, stage, receipt message, idempotent poll); no auto-verify on untrusted sender / mismatch / edited receipt.

## Milestone 10 — Dashboard and reports
- Dashboard (period + team filters, scoped: owner/admin all, team lead own teams, staff self): incoming chats vs previous period, needs staff (+ waiting over 1 h), first reply time staff vs bot, deposits from chat (bot vs staff), funnel chats → price given → booking link → deposit, bot vs staff share with top handover reasons and failed messages, waiting longest, per team, system setup progress.
- Full report tabs: Staff (chats, first reply, deposits, closing rate), Bot (per agent: chats, handovers + rate, deposits from AI alone, drafts used unedited; handovers by day; reasons), Funnel (by source + lost reasons), Cost (owner/admin: Claude by model, Meta templates by category, cost per deposit, prompt-caching savings). CSV export per tab.
- One SQL function per screen (`rpc_dashboard`, `rpc_reports`) with role scoping; charts follow the dataviz rules (validated colours, thin bars, hover tooltips, legends/direct labels, table view).
- Tests: pgTAP for dashboard/report scoping and access.

## Milestone 11 — Hardening
- Playwright end-to-end tests (`web/e2e`, run with `npm run e2e`) against the local stack, mock providers, production build: inbound message → AI reply; handover → staff take over → draft used; window closed → template; seat lock → receipt → payment verification → after-sales; itinerary upload → questions → activate; broadcast with opt-out. All pass.
- Bugs the e2e tests found and fixed: router now reads the whole debounced burst; staff-held chats get AI drafts; composer switches back to Reply after taking over; mock seat-lock flow uses known details.
- Webhook load test (`supabase/functions/_dev/loadtest.ts`): 500 messages/minute, 0 errors, p95 39 ms, duplicates ignored, exactly-once storage; every chat answered by the AI.
- Error monitoring hooks: Edge Function errors (structured log + optional `ERROR_WEBHOOK_URL`), Next.js `onRequestError`, browser error boundary → `/api/client-error`.
- Meta send rate limit (per channel, Postgres) plus retry with backoff on Meta throughput errors.
- Backups and operations note: `docs/operations.md`.
- Accessibility pass with axe (WCAG 2 A/AA, serious + critical) on 25 screens plus the phone inbox: fixed link styling in text, label chip contrast, faint timestamps, focusable scroll areas, alert/button roles. Labels, focus outlines and 44 px touch targets were already in place.

Checks: `npm run check` (deno check + lint + test, tsc + eslint + vitest, pgTAP).
