-- Dashboard and reports. Scope: owner/admin all; team lead own teams; staff self.

create or replace function public.report_scope_convs(p_team uuid)
returns table (id uuid) language sql stable security definer set search_path = public as $$
  select c.id from public.conversations c
  where c.company_id = public.auth_company_id()
    and (p_team is null or c.team_id = p_team)
    and (
      public.auth_is_admin()
      or (public.auth_has_role(array['team_lead']) and (c.team_id = any(public.auth_team_ids()) or c.holder_member_id = public.auth_member_id()))
      or (public.auth_has_role(array['staff']) and (c.holder_member_id = public.auth_member_id()
          or exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_member_id = public.auth_member_id())))
    )
$$;

create or replace function public.rpc_dashboard(p_from timestamptz, p_to timestamptz, p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; cid uuid := public.auth_company_id();
begin
  if public.auth_member_id() is null or public.auth_has_role(array['accounts']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  with scope as (select id from public.report_scope_convs(p_team)),
  inbound as (select distinct m.conversation_id from public.messages m join scope s on s.id = m.conversation_id where m.direction = 'in' and m.created_at >= p_from and m.created_at < p_to),
  first_in as (
    select m.conversation_id, min(m.created_at) as t from public.messages m join inbound i on i.conversation_id = m.conversation_id
    where m.direction = 'in' and m.created_at >= p_from and m.created_at < p_to group by 1),
  first_reply as (
    select f.conversation_id,
      (select min(o.created_at) from public.messages o where o.conversation_id = f.conversation_id and o.sender_type = 'staff' and not o.is_internal_note and o.created_at > f.t) - f.t as staff_gap,
      (select min(o.created_at) from public.messages o where o.conversation_id = f.conversation_id and o.sender_type = 'ai' and o.type = 'text' and o.created_at > f.t) - f.t as bot_gap
    from first_in f),
  priced as (select distinct m.conversation_id from public.messages m join inbound i on i.conversation_id = m.conversation_id
    where m.created_at >= p_from and m.created_at < p_to and ((m.type = 'tool' and m.body like 'Tool: search_products%') or (m.direction = 'out' and m.body ~ 'RM\s?\d'))),
  linked as (select distinct m.conversation_id from public.messages m join inbound i on i.conversation_id = m.conversation_id
    where m.created_at >= p_from and m.created_at < p_to and ((m.type = 'tool' and m.body like 'Tool: create_seat_lock_link%') or (m.direction = 'out' and m.body ilike '%lock%'))),
  deposits as (select distinct m.conversation_id from public.messages m join scope s on s.id = m.conversation_id
    where m.type = 'event' and m.meta ->> 'kind' = 'stage' and m.meta ->> 'stage' in ('deposit','full_payment') and m.created_at >= p_from and m.created_at < p_to),
  staffed as (select distinct m.conversation_id from public.messages m join inbound i on i.conversation_id = m.conversation_id where m.sender_type = 'staff' and not m.is_internal_note and m.created_at >= p_from and m.created_at < p_to),
  handovers as (select m.body from public.messages m join scope s on s.id = m.conversation_id where m.type = 'event' and m.meta ->> 'kind' = 'needs_staff' and m.created_at >= p_from and m.created_at < p_to)
  select jsonb_build_object(
    'incoming_chats', (select count(*) from inbound),
    'incoming_prev', (select count(distinct m.conversation_id) from public.messages m join scope s on s.id = m.conversation_id where m.direction = 'in' and m.created_at >= p_from - (p_to - p_from) and m.created_at < p_from),
    'needs_staff', (select count(*) from public.conversations c join scope s on s.id = c.id where c.needs_staff and c.status <> 'closed'),
    'needs_staff_over_1h', (select count(*) from public.conversations c join scope s on s.id = c.id where c.needs_staff and c.status <> 'closed' and c.needs_staff_since < now() - interval '1 hour'),
    'first_reply_staff_s', (select coalesce(round(extract(epoch from avg(staff_gap))), 0) from first_reply where staff_gap is not null),
    'first_reply_bot_s', (select coalesce(round(extract(epoch from avg(bot_gap))), 0) from first_reply where bot_gap is not null),
    'deposits', (select count(*) from deposits),
    'deposits_bot', (select count(*) from deposits d where not exists (select 1 from public.messages m where m.conversation_id = d.conversation_id and m.sender_type = 'staff' and not m.is_internal_note)),
    'funnel', jsonb_build_array(
      jsonb_build_object('label', 'Chats', 'n', (select count(*) from inbound)),
      jsonb_build_object('label', 'Price given', 'n', (select count(*) from priced)),
      jsonb_build_object('label', 'Booking link', 'n', (select count(*) from linked)),
      jsonb_build_object('label', 'Deposit', 'n', (select count(*) from deposits))),
    'priced_no_link', (select count(*) from priced p where not exists (select 1 from linked l where l.conversation_id = p.conversation_id)),
    'bot_only', (select count(*) from inbound i where not exists (select 1 from staffed s where s.conversation_id = i.conversation_id)),
    'handed_to_staff', (select count(*) from staffed),
    'handover_reasons', coalesce((select jsonb_agg(x) from (select regexp_replace(body, '^Needs staff: ', '') as reason, count(*) as n from handovers group by 1 order by 2 desc limit 5) x), '[]'),
    'failed_messages', (select count(*) from public.messages m join scope s on s.id = m.conversation_id where m.status = 'failed' and m.created_at >= p_from and m.created_at < p_to),
    'waiting_longest', coalesce((select jsonb_agg(x) from (
      select c.id, coalesce(ct.name, ct.wa_id) as name, c.needs_staff_reason as why, t.name as team, c.needs_staff_since as since
      from public.conversations c join scope s on s.id = c.id join public.contacts ct on ct.id = c.contact_id left join public.teams t on t.id = c.team_id
      where c.needs_staff and c.status <> 'closed' order by c.needs_staff_since limit 5) x), '[]'),
    'teams', coalesce((select jsonb_agg(x) from (
      select t.id, t.name, count(c.id) filter (where c.status <> 'closed') as open, count(c.id) filter (where c.needs_staff and c.status <> 'closed') as needs_staff
      from public.teams t left join public.conversations c on c.team_id = t.id and c.id in (select id from scope)
      where t.company_id = cid and (public.auth_is_admin() or t.id = any(public.auth_team_ids())) group by t.id, t.name order by t.name) x), '[]')
  ) into r;
  return r;
end $$;

create or replace function public.rpc_reports(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; cid uuid := public.auth_company_id(); rate numeric;
begin
  if public.auth_member_id() is null or public.auth_has_role(array['accounts']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce((settings ->> 'usd_to_myr')::numeric, 4.4) into rate from public.companies where id = cid;
  with scope as (select id from public.report_scope_convs(null)),
  deposits as (select distinct m.conversation_id from public.messages m join scope s on s.id = m.conversation_id
    where m.type = 'event' and m.meta ->> 'kind' = 'stage' and m.meta ->> 'stage' in ('deposit','full_payment') and m.created_at >= p_from and m.created_at < p_to),
  inbound as (select distinct m.conversation_id from public.messages m join scope s on s.id = m.conversation_id where m.direction = 'in' and m.created_at >= p_from and m.created_at < p_to)
  select jsonb_build_object(
    'staff', coalesce((select jsonb_agg(x order by x.chats desc) from (
      select mb.id, mb.display_name as name,
        count(distinct m.conversation_id) as chats,
        coalesce(round(extract(epoch from avg(fr.gap))), 0) as first_reply_s,
        count(distinct d.conversation_id) as deposits
      from public.members mb
      join public.messages m on m.sender_member_id = mb.id and m.sender_type = 'staff' and not m.is_internal_note and m.created_at >= p_from and m.created_at < p_to
      join scope s on s.id = m.conversation_id
      left join deposits d on d.conversation_id = m.conversation_id
      left join lateral (
        select (select min(o.created_at) from public.messages o where o.conversation_id = i.conversation_id and o.sender_member_id = mb.id and o.created_at > i.created_at) - i.created_at as gap
        from public.messages i where i.conversation_id = m.conversation_id and i.direction = 'in' and i.created_at >= p_from order by i.created_at limit 1) fr on true
      where mb.company_id = cid group by mb.id, mb.display_name) x), '[]'),
    'bot', coalesce((select jsonb_agg(x order by x.chats desc) from (
      select a.id, a.name,
        count(distinct m.conversation_id) as chats,
        (select count(*) from public.ai_runs ar where ar.agent_id = a.id and ar.decision = 'handover' and ar.created_at >= p_from and ar.created_at < p_to) as handovers,
        (select count(*) from deposits d join public.conversations c on c.id = d.conversation_id where c.agent_id = a.id
           and not exists (select 1 from public.messages sm where sm.conversation_id = d.conversation_id and sm.sender_type = 'staff' and not sm.is_internal_note)) as deposits_ai_only,
        (select count(*) filter (where status = 'used') from public.ai_drafts dr where dr.agent_id = a.id and dr.created_at >= p_from and dr.created_at < p_to) as drafts_used,
        (select count(*) filter (where status in ('used','edited','discarded')) from public.ai_drafts dr where dr.agent_id = a.id and dr.created_at >= p_from and dr.created_at < p_to) as drafts_decided
      from public.agents a
      left join public.messages m on m.sender_agent_id = a.id and m.sender_type = 'ai' and m.type = 'text' and m.created_at >= p_from and m.created_at < p_to
        and m.conversation_id in (select id from scope)
      where a.company_id = cid group by a.id, a.name) x), '[]'),
    'handover_reasons', coalesce((select jsonb_agg(x) from (
      select regexp_replace(m.body, '^Needs staff: ', '') as reason, count(*) as n from public.messages m join scope s on s.id = m.conversation_id
      where m.type = 'event' and m.meta ->> 'kind' = 'needs_staff' and m.created_at >= p_from and m.created_at < p_to group by 1 order by 2 desc limit 10) x), '[]'),
    'handovers_by_day', coalesce((select jsonb_agg(x order by x.day) from (
      select to_char(date_trunc('day', m.created_at at time zone 'Asia/Kuala_Lumpur'), 'YYYY-MM-DD') as day, count(*) as n from public.messages m join scope s on s.id = m.conversation_id
      where m.type = 'event' and m.meta ->> 'kind' = 'needs_staff' and m.created_at >= p_from and m.created_at < p_to group by 1) x), '[]'),
    'funnel_by_source', coalesce((select jsonb_agg(x order by x.chats desc) from (
      select coalesce(src.name, 'Direct') as source,
        count(distinct i.conversation_id) as chats,
        count(distinct i.conversation_id) filter (where exists (select 1 from public.messages p where p.conversation_id = i.conversation_id and ((p.type = 'tool' and p.body like 'Tool: search_products%') or (p.direction = 'out' and p.body ~ 'RM\s?\d')))) as price_given,
        count(distinct i.conversation_id) filter (where exists (select 1 from public.messages p where p.conversation_id = i.conversation_id and p.type = 'tool' and p.body like 'Tool: create_seat_lock_link%')) as booking_link,
        count(distinct d.conversation_id) as deposits
      from inbound i
      left join lateral (select l.name from public.conversation_labels cl join public.labels l on l.id = cl.label_id where cl.conversation_id = i.conversation_id and l."group" = 'source' limit 1) src on true
      left join deposits d on d.conversation_id = i.conversation_id
      group by 1) x), '[]'),
    'lost_reasons', coalesce((select jsonb_agg(x) from (select c.lost_reason as reason, count(*) as n from public.conversations c join scope s on s.id = c.id
      where c.lost_reason is not null and c.updated_at >= p_from and c.updated_at < p_to group by 1 order by 2 desc) x), '[]'),
    'claude_by_model', case when public.auth_is_admin() then coalesce((select jsonb_agg(x) from (
      select model, round(sum(cost)::numeric, 4) as usd, round(sum(cost)::numeric * rate, 2) as rm, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_read_tokens) as cache_read_tokens
      from public.ai_runs where company_id = cid and created_at >= p_from and created_at < p_to group by model order by 2 desc) x), '[]') else '[]' end,
    'meta_templates', case when public.auth_is_admin() then coalesce((select jsonb_agg(x) from (
      select t.category, count(*) as sent, round(count(*) * coalesce((c.settings -> 'meta_rates_rm' ->> t.category)::numeric, 0), 2) as rm
      from public.messages m join public.templates t on t.company_id = m.company_id and t.name = m.template_name join public.companies c on c.id = m.company_id
      where m.company_id = cid and m.type = 'template' and m.status in ('sent','delivered','read') and m.created_at >= p_from and m.created_at < p_to group by t.category, c.settings) x), '[]') else '[]' end,
    'caching_savings_rm', case when public.auth_is_admin() then (select coalesce(round(sum(cache_read_tokens * (case when model like '%haiku%' then 0.09 when model like '%opus%' then 3.8 else 1.9 end) / 1000000.0) * rate, 2), 0)
      from public.ai_runs where company_id = cid and created_at >= p_from and created_at < p_to) else null end,
    'deposits', (select count(*) from deposits)
  ) into r;
  return r;
end $$;
