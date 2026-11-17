-- MTB Inbox core schema. Every tenant table carries company_id and is protected by RLS.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Companies & people
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  reply_language text not null default 'ms',
  office_hours jsonb not null default '{"mon":["09:00","18:00"],"tue":["09:00","18:00"],"wed":["09:00","18:00"],"thu":["09:00","18:00"],"fri":["09:00","18:00"],"sat":["09:00","13:00"],"sun":null}',
  plan text not null default 'internal',
  -- models, spend cap, night-job permissions, meta template rates, quiet hours …
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  role text not null check (role in ('owner','admin','team_lead','staff','accounts')),
  display_name text not null,
  status text not null default 'invited' check (status in ('invited','active','disabled')),
  on_leave_until date,
  leave_source text check (leave_source in ('manual','hrboost')),
  last_seen_at timestamptz,
  avatar_color text not null default '#0E7C66',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  is_general boolean not null default false,
  lead_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, member_id)
);

-- 2-step verification: a Supabase auth session (JWT session_id) verified by an emailed code.
create table public.mfa_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.mfa_codes (session_id);

-- ---------------------------------------------------------------------------
-- Auth helpers used by RLS (security definer, bypass RLS on members)
-- ---------------------------------------------------------------------------
create or replace function public.auth_session_verified() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mfa_codes c
    where c.user_id = auth.uid()
      and c.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
      and c.verified_at is not null
  )
$$;

-- The current member row, or nothing. Owners/admins only count once their session passed 2-step,
-- unless the company disabled 2-step (settings.require_2fa = false, used by local tests only).
create or replace function public.auth_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.id
  from public.members m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (
      m.role not in ('owner','admin')
      or coalesce((c.settings ->> 'require_2fa')::boolean, true) = false
      or public.auth_session_verified()
    )
$$;

create or replace function public.auth_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.company_id from public.members m where m.id = public.auth_member_id()
$$;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.members m where m.id = public.auth_member_id()
$$;

create or replace function public.auth_has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = any(roles), false)
$$;

create or replace function public.auth_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_has_role(array['owner','admin'])
$$;

create or replace function public.auth_team_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(tm.team_id), '{}')
  from public.team_members tm where tm.member_id = public.auth_member_id()
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp channel, contacts, conversations, messages
-- ---------------------------------------------------------------------------
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  display_name text not null,
  phone_display text,
  waba_id text,
  phone_number_id text unique,
  quality_rating text,
  messaging_tier text,
  webhook_verify_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  name text,
  email text,
  state text,
  opt_in boolean not null default false,
  opt_in_at timestamptz,
  opt_in_source text,
  opted_out_at timestamptz,
  owner_member_id uuid references public.members(id) on delete set null,
  travelboost_customer_id text,
  merged_into_id uuid references public.contacts(id) on delete set null,
  source text,
  passport_status jsonb not null default '[]'::jsonb,
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, wa_id)
);
create index on public.contacts using gin (name extensions.gin_trgm_ops);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  avatar_url text,
  avatar_color text not null default '#5B4BC4',
  description text,
  persona text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  default_staff_member_id uuid references public.members(id) on delete set null,
  mode text not null default 'assist' check (mode in ('follow_schedule','auto','assist','off')),
  schedule jsonb,
  status text not null default 'training' check (status in ('training','live','resting')),
  travelboost_product_ids text[] not null default '{}',
  destination_keywords text[] not null default '{}',
  model_chat text,
  model_router text,
  close_sale_instructions text not null default '',
  aftersales_instructions text not null default '',
  approved_by uuid references public.members(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'open' check (status in ('open','waiting_customer','closed')),
  team_id uuid references public.teams(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  holder_type text not null default 'none' check (holder_type in ('ai','staff','none')),
  holder_member_id uuid references public.members(id) on delete set null,
  holder_since timestamptz,
  needs_staff boolean not null default false,
  needs_staff_reason text,
  needs_staff_since timestamptz,
  stage text not null default 'lead' check (stage in ('lead','booking','deposit','full_payment','trip_done','lost')),
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_staff_reply_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  staff_typing_until timestamptz,
  routing_state text not null default 'new' check (routing_state in ('new','asked','routed')),
  referral jsonb,
  ai_summary text,
  key_details jsonb not null default '{}'::jsonb,
  booking_ref text,
  trip_date date,
  lost_reason text,
  templates_sent int not null default 0,
  misunderstood_count int not null default 0,
  ai_pending_since timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id),
  check (holder_type <> 'staff' or holder_member_id is not null)
);
create index on public.conversations (company_id, last_message_at desc);
create index on public.conversations (company_id, needs_staff) where needs_staff;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender_type text not null check (sender_type in ('customer','staff','ai','system')),
  sender_member_id uuid references public.members(id) on delete set null,
  sender_agent_id uuid references public.agents(id) on delete set null,
  type text not null default 'text' check (type in ('text','image','document','audio','video','sticker','location','template','interactive','button','reaction','note','event','tool','unsupported')),
  body text,
  media_path text,
  media_mime text,
  media_filename text,
  template_name text,
  template_vars jsonb,
  interactive jsonb,
  wa_message_id text unique,
  status text not null default 'queued' check (status in ('received','queued','sent','delivered','read','failed')),
  error_code text,
  error_text text,
  is_internal_note boolean not null default false,
  ai_run_id uuid,
  reply_to_wa_id text,
  meta jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Labels, notes, audit log
-- ---------------------------------------------------------------------------
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  "group" text not null check ("group" in ('temperature','source','attention','custom')),
  name text not null,
  colour text not null default '#475467',
  single_per_chat boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, "group", name)
);

create table public.conversation_labels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  set_by_type text not null check (set_by_type in ('ai','staff','system')),
  set_by_member_id uuid references public.members(id) on delete set null,
  set_by_agent_id uuid references public.agents(id) on delete set null,
  reason text,
  confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, label_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_type text not null default 'staff' check (actor_type in ('staff','ai','system')),
  actor_member_id uuid references public.members(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.events (company_id, created_at desc);

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shortcut text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, shortcut)
);

-- ---------------------------------------------------------------------------
-- Templates & broadcasts
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]+$'),
  category text not null default 'MARKETING' check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  language text not null default 'ms',
  status text not null default 'DRAFT' check (status in ('DRAFT','SUGGESTED','PENDING','APPROVED','REJECTED','PAUSED','DISABLED')),
  rejection_reason text,
  components jsonb not null default '[]'::jsonb,
  meta_template_id text,
  used_by text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name, language)
);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  channel_id uuid references public.channels(id) on delete set null,
  template_name text not null,
  template_language text not null default 'ms',
  variable_mapping jsonb not null default '{}'::jsonb,
  segment jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  handover_agent_id uuid references public.agents(id) on delete set null,
  estimated_cost numeric(12,2),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','replied','failed','skipped')),
  wa_message_id text,
  error_text text,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broadcast_id, contact_id)
);
create index on public.broadcast_recipients (wa_message_id);

-- ---------------------------------------------------------------------------
-- AI team
-- ---------------------------------------------------------------------------
create table public.knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scope text not null check (scope in ('company','agent')),
  agent_id uuid references public.agents(id) on delete cascade,
  section text not null,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  content text not null default '',
  source text not null default 'staff' check (source in ('staff','night_job','itinerary','owner','seed')),
  created_by uuid references public.members(id) on delete set null,
  activated_at timestamptz,
  activated_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'company') = (agent_id is null)),
  unique (company_id, scope, agent_id, section, version)
);
create unique index knowledge_one_active on public.knowledge_docs
  (company_id, scope, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), section)
  where status = 'active';

create table public.official_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scope text not null default 'company' check (scope in ('company','agent')),
  agent_id uuid references public.agents(id) on delete cascade,
  question text not null,
  variants text[] not null default '{}',
  answer text not null,
  usage_count int not null default 0,
  source text not null default 'staff' check (source in ('staff','night_job','owner')),
  status text not null default 'active' check (status in ('active','draft','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.official_answers using gin (question extensions.gin_trgm_ops);

create table public.itineraries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  travelboost_product_id text not null,
  applies_to jsonb not null default '"all"'::jsonb,
  file_path text,
  file_name text,
  extracted jsonb,
  status text not null default 'extracting' check (status in ('extracting','needs_answers','ready','active','failed','archived')),
  error_text text,
  knowledge_doc_id uuid references public.knowledge_docs(id) on delete set null,
  uploaded_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.itinerary_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  itinerary_id uuid not null references public.itineraries(id) on delete cascade,
  question text not null,
  why text,
  options text[] not null default '{}',
  answer text,
  answered_by uuid references public.members(id) on delete set null,
  assigned_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  priority int not null default 100,
  type text not null check (type in ('ad','keyword','ask','fallback')),
  match jsonb not null default '{}'::jsonb,
  target_agent_id uuid references public.agents(id) on delete cascade,
  target_team_id uuid references public.teams(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.followup_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  key text not null,
  mode text not null default 'close_sale' check (mode in ('close_sale','after_sales','event')),
  trigger text not null,
  delay_minutes int not null,
  message_kind text not null check (message_kind in ('free','template')),
  template_name text,
  prompt_hint text,
  sort int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, agent_id, key)
);

create table public.followup_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  step_id uuid references public.followup_steps(id) on delete cascade,
  kind text not null default 'followup' check (kind in ('followup','aftersales','event','staff_reminder')),
  step_key text not null,
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','done','cancelled','skipped','failed')),
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.followup_jobs (status, due_at);
create unique index followup_jobs_one_pending on public.followup_jobs (conversation_id, step_key) where status = 'pending';

create table public.aftersales_schedule (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  key text not null,
  days_before_trip int, -- null = on deposit
  action text not null,
  template_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, agent_id, key)
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  purpose text not null default 'reply' check (purpose in ('reply','draft','router','followup','summary','itinerary','judge','test','night_job','receipt')),
  model text not null,
  mode text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost numeric(12,6) not null default 0,
  tool_calls jsonb not null default '[]'::jsonb,
  decision text check (decision in ('sent','discarded','handover','draft','rerun','none','error')),
  discard_reason text,
  knowledge_versions jsonb,
  official_answer_id uuid,
  latency_ms int,
  error_text text,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_runs (company_id, created_at desc);

create table public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  body text not null,
  seat_data jsonb,
  status text not null default 'pending' check (status in ('pending','used','edited','discarded','superseded')),
  final_text text,
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_scenarios (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  key text,
  name text not null,
  customer_messages text[] not null,
  rubric text not null,
  checks jsonb not null default '{}'::jsonb,
  is_seed boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null,
  agent_id uuid references public.agents(id) on delete cascade,
  scenario_id uuid references public.test_scenarios(id) on delete cascade,
  context text not null default 'manual',
  passed boolean not null,
  transcript jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Night job
-- ---------------------------------------------------------------------------
create table public.night_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report_date date not null,
  phases jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  body text,
  status text not null default 'running' check (status in ('running','ready','sent','failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, report_date)
);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  night_report_id uuid references public.night_reports(id) on delete cascade,
  kind text not null check (kind in ('official_answer','rule','knowledge','style','staff','label','question')),
  team_id uuid references public.teams(id) on delete set null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','rolled_back')),
  auto_applied boolean not null default false,
  applied_ref jsonb,
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table public.payment_verifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  booking_ref text,
  invoice_id text,
  invoice_amount numeric(12,2),
  lead_guest_name text,
  receipt_media_path text,
  receipt_amount numeric(12,2),
  receipt_date date,
  receipt_reference text,
  receipt_sender text,
  edited_suspect boolean not null default false,
  bank_email jsonb,
  match jsonb not null default '{}'::jsonb,
  ai_opinion text,
  reason text,
  status text not null default 'pending' check (status in ('pending','auto_verified','verified','rejected','asked_customer')),
  verified_by uuid references public.members(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bank_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  raw_id text not null,
  from_address text,
  subject text,
  received_at timestamptz,
  parsed jsonb not null default '{}'::jsonb,
  matched_verification_id uuid references public.payment_verifications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, raw_id)
);

-- ---------------------------------------------------------------------------
-- Integrations, notifications, spend, webhooks
-- ---------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null check (key in ('meta_whatsapp','smtp','web_push','claude','travelboost','bank_email','hrboost','meta_ads','sleekflow')),
  status text not null default 'not_connected' check (status in ('not_connected','connected','error')),
  config jsonb not null default '{}'::jsonb,
  -- field -> {vault_id, last4}
  secret_refs jsonb not null default '{}'::jsonb,
  last_test_at timestamptz,
  last_test_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

create table public.notification_prefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  event text not null,
  sound boolean not null default true,
  push boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, event)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.notifications (member_id, created_at desc);

create table public.spend (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null,
  provider text not null,
  amount numeric(14,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month, provider)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  source text not null,
  event_id text not null,
  payload jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, event_id)
);

-- updated_at triggers on every table that has the column
do $$
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t.table_name);
  end loop;
end $$;

-- Realtime
alter publication supabase_realtime add table public.conversations, public.messages, public.conversation_labels,
  public.ai_drafts, public.notifications, public.payment_verifications, public.itinerary_questions;
alter table public.messages replica identity full;
alter table public.conversations replica identity full;
