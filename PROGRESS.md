# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Foundation | ✅ done |
| 2 | WhatsApp core + Inbox | ⏳ |
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

Checks: `npm run check` (deno check + lint + test, tsc + eslint + vitest, pgTAP).
