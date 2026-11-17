-- Row Level Security. The service role (Edge Functions) bypasses RLS; browsers never get it.
-- Writes to conversations/messages/labels-on-chats go through security-definer RPCs (see rpc migration).

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Conversation visibility (inbox matrix):
--   owner/admin: all; team_lead & staff: own team, unassigned team, or held by me; accounts: none.
create or replace function public.can_see_conversation(c_company uuid, c_team uuid, c_holder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(c_company = public.auth_company_id() and (
    public.auth_is_admin()
    or (public.auth_has_role(array['team_lead','staff']) and (
      c_team is null or c_team = any(public.auth_team_ids()) or c_holder = public.auth_member_id()
    ))
  ), false)
$$;

create or replace function public.can_see_conversation_id(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c where c.id = conv
    and public.can_see_conversation(c.company_id, c.team_id, c.holder_member_id))
$$;

create or replace function public.can_see_contact(ct_company uuid, ct_id uuid, ct_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(ct_company = public.auth_company_id() and (
    public.auth_is_admin()
    or (public.auth_has_role(array['team_lead','staff']) and (
      ct_owner = public.auth_member_id()
      or exists (select 1 from public.conversations c where c.contact_id = ct_id
                 and public.can_see_conversation(c.company_id, c.team_id, c.holder_member_id))
    ))
  ), false)
$$;

-- companies
create policy companies_read on public.companies for select using (id = public.auth_company_id());
create policy companies_update on public.companies for update using (id = public.auth_company_id() and public.auth_is_admin());

-- Readable by every active member of the company; writable by owner/admin.
do $$
declare t text;
begin
  foreach t in array array['members','teams','team_members','channels','labels','quick_replies','agents',
                           'routing_rules','followup_steps','aftersales_schedule'] loop
    execute format('create policy %1$s_read on public.%1$I for select using (company_id = public.auth_company_id())', t);
    execute format('create policy %1$s_write on public.%1$I for all using (company_id = public.auth_company_id() and public.auth_is_admin()) with check (company_id = public.auth_company_id() and public.auth_is_admin())', t);
  end loop;
end $$;

-- Members can update their own last_seen_at / display name.
create policy members_self_update on public.members for update
  using (id = public.auth_member_id()) with check (id = public.auth_member_id() and role = public.auth_role());

-- AI knowledge: owner/admin write, team lead view.
do $$
declare t text;
begin
  foreach t in array array['knowledge_docs','official_answers','itineraries','test_scenarios','test_runs'] loop
    execute format('create policy %1$s_read on public.%1$I for select using (company_id = public.auth_company_id() and public.auth_has_role(array[''owner'',''admin'',''team_lead'']))', t);
    execute format('create policy %1$s_write on public.%1$I for all using (company_id = public.auth_company_id() and public.auth_is_admin()) with check (company_id = public.auth_company_id() and public.auth_is_admin())', t);
  end loop;
end $$;

-- Itinerary questions: admins, plus whoever they were assigned to.
create policy itq_read on public.itinerary_questions for select using (
  company_id = public.auth_company_id() and (public.auth_has_role(array['owner','admin','team_lead']) or assigned_member_id = public.auth_member_id()));
create policy itq_write on public.itinerary_questions for all
  using (company_id = public.auth_company_id() and public.auth_is_admin())
  with check (company_id = public.auth_company_id() and public.auth_is_admin());
create policy itq_answer on public.itinerary_questions for update
  using (company_id = public.auth_company_id() and assigned_member_id = public.auth_member_id())
  with check (company_id = public.auth_company_id() and assigned_member_id = public.auth_member_id());

-- Templates: everyone in the inbox reads (template picker); admins write; team leads may suggest.
create policy templates_read on public.templates for select using (company_id = public.auth_company_id() and not public.auth_has_role(array['accounts']));
create policy templates_write on public.templates for all
  using (company_id = public.auth_company_id() and public.auth_is_admin())
  with check (company_id = public.auth_company_id() and public.auth_is_admin());
create policy templates_suggest on public.templates for insert
  with check (company_id = public.auth_company_id() and public.auth_has_role(array['team_lead']) and status = 'SUGGESTED');

-- Broadcasts: admins; team leads read and suggest drafts.
create policy broadcasts_read on public.broadcasts for select using (company_id = public.auth_company_id() and public.auth_has_role(array['owner','admin','team_lead']));
create policy broadcasts_write on public.broadcasts for all
  using (company_id = public.auth_company_id() and public.auth_is_admin())
  with check (company_id = public.auth_company_id() and public.auth_is_admin());
create policy broadcasts_suggest on public.broadcasts for insert
  with check (company_id = public.auth_company_id() and public.auth_has_role(array['team_lead']) and status = 'draft');
create policy broadcast_recipients_read on public.broadcast_recipients for select using (company_id = public.auth_company_id() and public.auth_has_role(array['owner','admin','team_lead']));

-- Contacts
create policy contacts_read on public.contacts for select using (public.can_see_contact(company_id, id, owner_member_id));
create policy contacts_admin on public.contacts for all
  using (company_id = public.auth_company_id() and public.auth_is_admin())
  with check (company_id = public.auth_company_id() and public.auth_is_admin());
create policy contacts_lead_update on public.contacts for update
  using (public.auth_has_role(array['team_lead']) and public.can_see_contact(company_id, id, owner_member_id))
  with check (company_id = public.auth_company_id());

-- Inbox data (read via RLS; writes via RPC)
create policy conversations_read on public.conversations for select using (public.can_see_conversation(company_id, team_id, holder_member_id));
create policy messages_read on public.messages for select using (company_id = public.auth_company_id() and public.can_see_conversation_id(conversation_id));
create policy conversation_labels_read on public.conversation_labels for select using (company_id = public.auth_company_id() and public.can_see_conversation_id(conversation_id));
create policy ai_drafts_read on public.ai_drafts for select using (company_id = public.auth_company_id() and public.can_see_conversation_id(conversation_id));
create policy followup_jobs_read on public.followup_jobs for select using (company_id = public.auth_company_id() and public.can_see_conversation_id(conversation_id));

create policy notes_read on public.notes for select using (
  company_id = public.auth_company_id() and (
    (contact_id is not null and exists (select 1 from public.contacts ct where ct.id = contact_id and public.can_see_contact(ct.company_id, ct.id, ct.owner_member_id)))
    or (conversation_id is not null and public.can_see_conversation_id(conversation_id))));
create policy notes_insert on public.notes for insert with check (
  company_id = public.auth_company_id() and member_id = public.auth_member_id() and not public.auth_has_role(array['accounts']));

-- Admin-only reads
do $$
declare t text;
begin
  foreach t in array array['events','ai_runs','spend'] loop
    execute format('create policy %1$s_read on public.%1$I for select using (company_id = public.auth_company_id() and public.auth_is_admin())', t);
  end loop;
end $$;

-- Morning report: owner/admin all, team lead reads.
create policy night_reports_read on public.night_reports for select using (company_id = public.auth_company_id() and public.auth_has_role(array['owner','admin','team_lead']));
create policy suggestions_read on public.suggestions for select using (
  company_id = public.auth_company_id() and (public.auth_is_admin() or (public.auth_has_role(array['team_lead']) and team_id = any(public.auth_team_ids()))));

-- Integrations: owner/admin read the non-secret config; only owner writes (secrets go through RPC).
create policy integrations_read on public.integrations for select using (company_id = public.auth_company_id() and public.auth_is_admin());
create policy integrations_owner on public.integrations for update
  using (company_id = public.auth_company_id() and public.auth_has_role(array['owner']))
  with check (company_id = public.auth_company_id() and public.auth_has_role(array['owner']));

-- Payment verification: owner + accounts act, admin views.
create policy payments_read on public.payment_verifications for select using (company_id = public.auth_company_id() and public.auth_has_role(array['owner','admin','accounts']));
create policy bank_emails_read on public.bank_emails for select using (company_id = public.auth_company_id() and public.auth_has_role(array['owner','accounts']));

-- Personal tables
do $$
declare t text;
begin
  foreach t in array array['notifications','notification_prefs','push_subscriptions'] loop
    execute format('create policy %1$s_own on public.%1$I for all using (member_id = public.auth_member_id()) with check (member_id = public.auth_member_id() and company_id = public.auth_company_id())', t);
  end loop;
end $$;

-- mfa_codes, webhook_events: service role only (RLS on, no policies).

-- Storage: one private bucket for chat media/receipts/itineraries, keyed by company id prefix.
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict do nothing;
create policy media_read on storage.objects for select using (
  bucket_id = 'media' and (storage.foldername(name))[1] = public.auth_company_id()::text);
create policy media_upload on storage.objects for insert with check (
  bucket_id = 'media' and (storage.foldername(name))[1] = public.auth_company_id()::text
  and not public.auth_has_role(array['accounts']));
