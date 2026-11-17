# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Foundation | ✅ done |
| 2 | WhatsApp core + Inbox | ✅ done |
| 3 | Contacts, labels, broadcast, templates, automation, activity log | ⏳ |
| 4 | Notifications and phone | ⏳ |
| 5 | Integrations panel | ⏳ |
| 6 | AI core | ⏳ |
| 7 | AI extras | ⏳ |
| 8 | Night job and morning report | ⏳ |
| 9 | Payment verification | ⏳ |
| 10 | Dashboard and reports | ⏳ |
| 11 | Hardening | ⏳ |
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

Checks: `npm run check` (deno check + lint + test, tsc + eslint + vitest, pgTAP).
