# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Foundation | ✅ done |
| 2 | WhatsApp core + Inbox | ✅ done |
| 3 | Contacts, labels, broadcast, templates, automation, activity log | ✅ done |
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

## Milestone 3 — Contacts, labels, broadcast, templates, automation, activity log
- Contacts: filters (stage, destination, temperature, source, owner, search), pagination, bulk assign / add label / add to broadcast / export, CSV import (SleekFlow export or generic; no opt-in assumed unless the file says so), add contact, duplicate detection (same name + email, different numbers) with merge, profile page (details, opt-in, timeline, TravelBoost bookings + passports, notes).
- Labels settings: groups with rules, "how it's set", active-chat counts, admin-only create/edit, 60-day unused warning.
- Broadcast: segment (stage, destination, labels, last chat, picked contacts) with live count of opted-in recipients, approved template with variable mapping, hand-over agent on reply, send now / schedule / draft, test to my number, estimated Meta cost, batches that respect quiet hours, per-broadcast sent/read/replied/failed.
- Templates: list with status, rejection reason, "used by"; create with [placeholders] → {{n}}, quick-reply buttons and examples; submit to Meta; sync; delete blocked while in use; team leads can suggest.
- Automation: round-robin (online, fewest open chats, skips leave), leave reassignment, staff-not-replying reminders (staff, then team lead), close old chats, HOT→WARM decay; settings screen with toggles and parameters. (Out-of-hours auto message runs in the AI orchestrator, milestone 6.)
- Staff & teams: invite, roles (owner-only for admin roles), deactivate, manual leave, WhatsApp number for test sends, team management, role matrix. Activity log with filter and CSV export.
- New companies get integration rows and default automation rules from a trigger (multi-tenant ready).
- Tests: pgTAP merge/segment/round-robin; Deno broadcast runner (opt-in only, quiet hours, batching) and reminders/auto-close; Vitest CSV import + template builder.

Checks: `npm run check` (deno check + lint + test, tsc + eslint + vitest, pgTAP).
