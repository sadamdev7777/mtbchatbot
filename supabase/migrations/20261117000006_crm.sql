-- Contacts, labels, broadcasts, automation.

alter table public.labels add column description text;
alter table public.members add column phone text;

update public.labels set description = case name
  when 'HOT' then 'Asks how to pay, asks to hold seats, gives a name for booking'
  when 'WARM' then 'Gave month and pax, hasn''t asked to book'
  when 'COLD' then 'Quiet after 2 templates, or tapped "Tak jadi"'
  when 'FB ad' then 'Ad referral data in the first message'
  when 'MATTA' then 'QR code or link from the MATTA fair'
  when 'Referral' then 'Customer mentions "kawan recommend" · AI suggests, staff confirms'
  when 'Repeat customer' then 'Has a past booking in TravelBoost'
  when 'VIP' then 'Marked manually by Owner or Admin'
  when 'Complaint' then 'Angry tone or complaint words'
  when 'Large group 10+' then '10 pax or more'
  else description end;

-- ---------------------------------------------------------------------------
-- Automation rules (only rules that do not overlap with agents)
-- ---------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null check (key in ('round_robin','leave','out_of_hours','staff_reminder','auto_close')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  runs_count int not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);
alter table public.automation_rules enable row level security;
create trigger set_updated_at before update on public.automation_rules for each row execute function public.set_updated_at();
create trigger audit_automation after update on public.automation_rules for each row execute function public.audit_row('enabled','config');
create policy automation_read on public.automation_rules for select using (company_id = public.auth_company_id() and public.auth_is_admin());
create policy automation_write on public.automation_rules for update
  using (company_id = public.auth_company_id() and public.auth_is_admin()) with check (company_id = public.auth_company_id() and public.auth_is_admin());

-- Every new company (SaaS tenant) gets its integration rows and default automation rules.
create or replace function public.init_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.integrations (company_id, key)
  select new.id, k from unnest(array['meta_whatsapp','smtp','web_push','claude','travelboost','bank_email','hrboost','meta_ads','sleekflow']) k
  on conflict do nothing;
  insert into public.automation_rules (company_id, key, enabled, config)
  select new.id, k.key, k.enabled, k.config from
   (values ('round_robin', true, '{"online_minutes":15}'::jsonb),
           ('leave', true, '{}'::jsonb),
           ('out_of_hours', true, '{"message":"Terima kasih kerana menghubungi Muslimtravelbug. Staf kami akan membalas esok pagi. Boleh cik kongsikan destinasi dan bulan yang dirancang?"}'::jsonb),
           ('staff_reminder', true, '{"minutes":30,"lead_after_minutes":60}'::jsonb),
           ('auto_close', false, '{"days":7}'::jsonb)) as k(key, enabled, config)
  on conflict do nothing;
  return new;
end $$;
create trigger companies_init after insert on public.companies for each row execute function public.init_company();

create or replace function public.bump_automation(p_company uuid, p_key text) returns void
language sql security definer set search_path = public as $$
  update public.automation_rules set runs_count = runs_count + 1, last_run_at = now() where company_id = p_company and key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Round-robin: online staff in the team with the fewest open chats, skipping anyone on leave.
-- ---------------------------------------------------------------------------
create or replace function public.pick_round_robin(p_team uuid, p_exclude uuid default null) returns uuid
language sql stable security definer set search_path = public as $$
  select m.id
  from public.team_members tm
  join public.members m on m.id = tm.member_id
  left join public.automation_rules ar on ar.company_id = m.company_id and ar.key = 'round_robin'
  where tm.team_id = p_team and m.status = 'active' and m.role in ('staff','team_lead','admin','owner')
    and (m.on_leave_until is null or m.on_leave_until < current_date)
    and m.id is distinct from p_exclude
    and m.last_seen_at > now() - make_interval(mins => coalesce((ar.config ->> 'online_minutes')::int, 15))
  order by (select count(*) from public.conversations c where c.holder_member_id = m.id and c.holder_type = 'staff' and c.status <> 'closed'),
           m.last_seen_at desc
  limit 1
$$;

-- Assign a chat to its team by round-robin (or leave it in the team queue). Returns the member or null.
create or replace function public.assign_round_robin(p_conv uuid, p_team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.conversations; pick uuid; enabled boolean; lead uuid; mname text; tname text;
begin
  select * into c from public.conversations where id = p_conv for update;
  select ar.enabled into enabled from public.automation_rules ar where ar.company_id = c.company_id and ar.key = 'round_robin';
  update public.conversations set team_id = p_team where id = p_conv;
  select name, lead_member_id into tname, lead from public.teams where id = p_team;
  if coalesce(enabled, true) then
    pick := public.pick_round_robin(p_team, null);
  end if;
  if pick is not null then
    select display_name into mname from public.members where id = pick;
    update public.conversations set holder_type = 'staff', holder_member_id = pick, holder_since = now() where id = p_conv;
    perform public.add_system_event(p_conv, 'Assigned to ' || mname || ' (' || tname || ', round-robin)', jsonb_build_object('kind','assign','member_id',pick,'team_id',p_team));
    perform public.notify_member(pick, case when c.needs_staff then 'needs_staff_assigned' else 'chat_assigned' end,
      'Chat assigned to you', coalesce(c.needs_staff_reason, c.last_message_preview), '/inbox?c=' || p_conv);
    perform public.bump_automation(c.company_id, 'round_robin');
  else
    perform public.add_system_event(p_conv, 'Waiting in the ' || tname || ' queue (no staff online)', jsonb_build_object('kind','assign','team_id',p_team));
    if lead is not null then
      perform public.notify_member(lead, 'needs_staff_assigned', 'Chat waiting in ' || tname || ' queue', coalesce(c.needs_staff_reason, c.last_message_preview), '/inbox?c=' || p_conv);
    end if;
  end if;
  return pick;
end $$;

-- ---------------------------------------------------------------------------
-- Contacts overview (security invoker → RLS of the caller applies)
-- ---------------------------------------------------------------------------
create or replace view public.contact_overview with (security_invoker = true) as
select ct.*,
  cv.id as conversation_id, cv.stage, cv.status as chat_status, cv.last_message_at, cv.team_id,
  cv.key_details ->> 'destination' as destination,
  coalesce((select array_agg(l.name order by l.name) from public.conversation_labels cl join public.labels l on l.id = cl.label_id where cl.conversation_id = cv.id), '{}') as label_names,
  coalesce((select array_agg(cl.label_id) from public.conversation_labels cl where cl.conversation_id = cv.id), '{}') as label_ids
from public.contacts ct
left join lateral (
  select * from public.conversations c where c.contact_id = ct.id order by c.last_message_at desc nulls last limit 1
) cv on true
where ct.merged_into_id is null;

-- Possible duplicates: same name and email, different numbers.
create or replace view public.contact_duplicates with (security_invoker = true) as
select a.id as keep_id, b.id as merge_id, a.name, a.email, a.wa_id as keep_wa_id, b.wa_id as merge_wa_id
from public.contacts a
join public.contacts b on a.company_id = b.company_id and a.id < b.id
  and lower(trim(a.name)) = lower(trim(b.name)) and lower(trim(a.email)) = lower(trim(b.email))
where a.email is not null and a.merged_into_id is null and b.merged_into_id is null;

-- Merge b into a: conversations/messages/notes move to a; b is kept as an alias (merged_into_id).
create or replace function public.rpc_merge_contacts(p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.contacts; m public.contacts; cv record; target uuid;
begin
  if not public.auth_has_role(array['owner','admin','team_lead']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into k from public.contacts where id = p_keep;
  select * into m from public.contacts where id = p_merge;
  if k.id is null or m.id is null or k.company_id <> public.auth_company_id() or m.company_id <> k.company_id or k.id = m.id then
    raise exception 'contact_not_found';
  end if;
  for cv in select * from public.conversations where contact_id = m.id loop
    select id into target from public.conversations where contact_id = k.id and channel_id = cv.channel_id;
    if target is null then
      update public.conversations set contact_id = k.id where id = cv.id;
    else
      update public.messages set conversation_id = target where conversation_id = cv.id;
      update public.notes set conversation_id = target where conversation_id = cv.id;
      update public.conversations set status = 'closed' where id = cv.id;
    end if;
  end loop;
  update public.notes set contact_id = k.id where contact_id = m.id;
  update public.contacts set
    email = coalesce(k.email, m.email), state = coalesce(k.state, m.state),
    travelboost_customer_id = coalesce(k.travelboost_customer_id, m.travelboost_customer_id),
    custom = k.custom || jsonb_build_object('other_numbers', coalesce(k.custom -> 'other_numbers', '[]'::jsonb) || to_jsonb(m.wa_id))
  where id = k.id;
  update public.contacts set merged_into_id = k.id where id = m.id;
  insert into public.events (company_id, actor_member_id, action, entity, entity_id, before, after)
  values (k.company_id, public.auth_member_id(), 'merge', 'contacts', k.id, jsonb_build_object('merged', m.id, 'wa_id', m.wa_id), jsonb_build_object('kept', k.id));
end $$;

create or replace function public.rpc_bulk_set_owner(p_contacts uuid[], p_member uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.auth_has_role(array['owner','admin','team_lead']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.contacts set owner_member_id = p_member
   where id = any(p_contacts) and company_id = public.auth_company_id() and public.can_see_contact(company_id, id, owner_member_id);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.rpc_bulk_label(p_contacts uuid[], p_label uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cv record; n int := 0;
begin
  if not public.auth_has_role(array['owner','admin','team_lead']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  for cv in select c.id from public.conversations c join public.contacts ct on ct.id = c.contact_id
            where ct.id = any(p_contacts) and ct.company_id = public.auth_company_id()
              and public.can_see_conversation(c.company_id, c.team_id, c.holder_member_id) loop
    perform public.apply_label(cv.id, p_label, 'staff', public.auth_member_id(), null, 'bulk', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Broadcast segments
-- segment: {stages:[], destinations:[], label_ids:[], last_chat_days:int, contact_ids:[]}
-- ---------------------------------------------------------------------------
create or replace function public.segment_contacts(p_company uuid, p_segment jsonb)
returns table (contact_id uuid) language sql stable security definer set search_path = public as $$
  select o.id from (
    select ct.id, ct.opt_in, ct.opted_out_at, ct.merged_into_id, cv.stage, cv.key_details ->> 'destination' as destination,
           cv.last_message_at, cv.id as conv_id
    from public.contacts ct
    left join lateral (select * from public.conversations c where c.contact_id = ct.id order by c.last_message_at desc nulls last limit 1) cv on true
    where ct.company_id = p_company
  ) o
  where o.opt_in and o.opted_out_at is null and o.merged_into_id is null
    and (coalesce(jsonb_array_length(p_segment -> 'contact_ids'), 0) = 0 or o.id::text in (select jsonb_array_elements_text(p_segment -> 'contact_ids')))
    and (coalesce(jsonb_array_length(p_segment -> 'stages'), 0) = 0 or o.stage in (select jsonb_array_elements_text(p_segment -> 'stages')))
    and (coalesce(jsonb_array_length(p_segment -> 'destinations'), 0) = 0 or o.destination in (select jsonb_array_elements_text(p_segment -> 'destinations')))
    and (coalesce(jsonb_array_length(p_segment -> 'label_ids'), 0) = 0 or exists (
          select 1 from public.conversation_labels cl where cl.conversation_id = o.conv_id
            and cl.label_id::text in (select jsonb_array_elements_text(p_segment -> 'label_ids'))))
    and ((p_segment ->> 'last_chat_days') is null or o.last_message_at > now() - make_interval(days => (p_segment ->> 'last_chat_days')::int))
$$;

create or replace function public.rpc_segment_count(p_segment jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.auth_company_id(); total int; excluded int;
begin
  if not public.auth_has_role(array['owner','admin','team_lead']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select count(*) into total from public.segment_contacts(cid, p_segment);
  select count(*) into excluded from public.contacts where company_id = cid and (opted_out_at is not null or not opt_in);
  return jsonb_build_object('recipients', total, 'not_opted_in_or_opted_out', excluded);
end $$;

-- Freeze recipients when a broadcast starts; makes sure each has a conversation on the channel.
create or replace function public.materialize_broadcast(p_broadcast uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b public.broadcasts; ch uuid; r record; n int := 0;
begin
  select * into b from public.broadcasts where id = p_broadcast for update;
  ch := coalesce(b.channel_id, (select id from public.channels where company_id = b.company_id and status = 'active' order by created_at limit 1));
  for r in select contact_id from public.segment_contacts(b.company_id, b.segment) loop
    insert into public.conversations (company_id, channel_id, contact_id) values (b.company_id, ch, r.contact_id)
    on conflict (channel_id, contact_id) do nothing;
    insert into public.broadcast_recipients (company_id, broadcast_id, contact_id) values (b.company_id, b.id, r.contact_id)
    on conflict do nothing;
    n := n + 1;
  end loop;
  update public.broadcasts set channel_id = ch where id = b.id;
  return n;
end $$;

-- A contact + conversation for "send a test to my number".
create or replace function public.rpc_test_conversation() returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.members; ct uuid; cv uuid; ch uuid;
begin
  select * into m from public.members where id = public.auth_member_id();
  if m.id is null or m.role not in ('owner','admin','team_lead') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(m.phone, '') = '' then raise exception 'set_your_phone' using hint = 'Add your WhatsApp number in Settings › Staff & teams'; end if;
  select id into ch from public.channels where company_id = m.company_id and status = 'active' order by created_at limit 1;
  insert into public.contacts (company_id, wa_id, name, opt_in, opt_in_at, opt_in_source)
  values (m.company_id, regexp_replace(m.phone, '\D', '', 'g'), m.display_name || ' (staff test)', true, now(), 'staff_test')
  on conflict (company_id, wa_id) do update set opt_in = true returning id into ct;
  insert into public.conversations (company_id, channel_id, contact_id, holder_type, holder_member_id, holder_since)
  values (m.company_id, ch, ct, 'staff', m.id, now())
  on conflict (channel_id, contact_id) do update set holder_type = 'staff', holder_member_id = m.id returning id into cv;
  return cv;
end $$;

-- Broadcast reply → hand the chat to the chosen agent (unless staff holds it).
create or replace function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare preview text; br record;
begin
  if new.is_internal_note or new.type in ('event','tool') then
    return new;
  end if;
  preview := left(coalesce(new.body, case new.type when 'template' then 'Template: ' || new.template_name else '[' || new.type || ']' end), 140);
  if new.direction = 'in' then
    update public.conversations set
      last_inbound_at = new.created_at,
      last_message_at = new.created_at,
      last_message_preview = preview,
      status = 'open',
      closed_at = null
    where id = new.conversation_id;
    update public.followup_jobs set status = 'cancelled', result = 'customer_replied'
      where conversation_id = new.conversation_id and status = 'pending' and kind in ('followup','event');
    for br in
      update public.broadcast_recipients r set status = 'replied', replied_at = now()
        from public.conversations c
        where c.id = new.conversation_id and r.contact_id = c.contact_id
          and r.status in ('sent','delivered','read') and r.sent_at > now() - interval '7 days'
        returning r.broadcast_id
    loop
      update public.conversations c set agent_id = b.handover_agent_id, holder_type = 'ai', holder_member_id = null, holder_since = now(), routing_state = 'routed'
        from public.broadcasts b
        where b.id = br.broadcast_id and b.handover_agent_id is not null and c.id = new.conversation_id and c.holder_type <> 'staff';
    end loop;
  else
    update public.conversations set
      last_outbound_at = new.created_at,
      last_message_at = new.created_at,
      last_message_preview = preview,
      last_staff_reply_at = case when new.sender_type = 'staff' then new.created_at else last_staff_reply_at end,
      status = case when status = 'closed' then status else 'waiting_customer' end
    where id = new.conversation_id;
  end if;
  return new;
end $$;

do $$
declare f text;
begin
  foreach f in array array['bump_automation(uuid,text)','pick_round_robin(uuid,uuid)','assign_round_robin(uuid,uuid)',
    'segment_contacts(uuid,jsonb)','materialize_broadcast(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- One reminder per unanswered customer message (and one escalation to the lead).
create unique index followup_jobs_staff_reminder_once on public.followup_jobs (conversation_id, step_key) where kind = 'staff_reminder';
