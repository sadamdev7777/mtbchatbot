-- Dashboard: live status of each AI agent. Mirrors the work-mode logic in
-- _shared/ai/orchestrator.ts (status, mode, office hours, spend cap) so the
-- dashboard says what an agent would do with a new message right now.
-- Counts use the caller's report scope, so staff only see their own chats.

create or replace function public.in_office_hours(p_hours jsonb, p_tz text, p_at timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  with l as (select p_at at time zone coalesce(p_tz, 'Asia/Kuala_Lumpur') as t),
  s as (select p_hours -> to_char((select t from l), 'fmdy') as span)
  select coalesce((select case when jsonb_typeof(span) = 'array'
    then (select t from l)::time >= (span ->> 0)::time and (select t from l)::time < (span ->> 1)::time
    else false end from s), false)
$$;

create or replace function public.rpc_agent_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb; cid uuid := public.auth_company_id(); co record; cap jsonb; capped boolean; claude text;
  day_start timestamptz;
begin
  if public.auth_member_id() is null or public.auth_has_role(array['accounts']) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select office_hours, timezone into co from public.companies where id = cid;
  cap := public.claude_cap_state(cid);
  capped := (cap ->> 'cap_rm') is not null and (cap ->> 'spent_rm')::numeric >= (cap ->> 'cap_rm')::numeric;
  select status into claude from public.integrations where company_id = cid and key = 'claude';
  day_start := (date_trunc('day', now() at time zone co.timezone)) at time zone co.timezone;

  with scope as (select id from public.report_scope_convs(null)),
  a as (
    select ag.*, public.in_office_hours(coalesce(ag.schedule -> 'office_hours', co.office_hours), co.timezone) as office
    from public.agents ag where ag.company_id = cid),
  m as (
    select a.*,
      case
        when a.status = 'resting' or a.mode = 'off' then 'off'
        when capped then 'off'
        when a.mode = 'auto' or (a.mode = 'follow_schedule' and not a.office) then
          case when a.status = 'training' then 'assist' else 'auto' end
        else 'assist' end as now_mode,
      case
        when a.status = 'resting' then 'Resting'
        when a.mode = 'off' then 'Switched off'
        when capped then 'Monthly Claude budget reached'
        when a.status = 'training' and (a.mode = 'auto' or (a.mode = 'follow_schedule' and not a.office)) then 'In training: drafts only until approved'
        when a.mode = 'follow_schedule' and a.office then 'Office hours: staff reply, AI drafts'
        when a.mode = 'follow_schedule' then 'Outside office hours: AI replies'
        when a.mode = 'auto' then 'Replies to customers'
        else 'Drafts replies for staff' end as why
    from a)
  select jsonb_build_object(
    'claude', coalesce(claude, 'not_connected'),
    'cap_reached', capped,
    'agents', coalesce((select jsonb_agg(x order by x.name) from (
      select m.id, m.name, m.avatar_color, coalesce(m.destination, m.description) as subtitle, m.status, m.mode, m.now_mode, m.why,
        (select count(*) from public.conversations c join scope s on s.id = c.id where c.agent_id = m.id and c.status <> 'closed') as open_chats,
        (select count(*) from public.conversations c join scope s on s.id = c.id where c.agent_id = m.id and c.status <> 'closed' and c.needs_staff) as needs_staff,
        (select count(*) from public.messages g join scope s on s.id = g.conversation_id where g.sender_agent_id = m.id and g.sender_type = 'ai' and g.type = 'text' and g.created_at >= day_start) as replies_today,
        (select count(*) from public.ai_drafts d join scope s on s.id = d.conversation_id where d.agent_id = m.id and d.created_at >= day_start) as drafts_today,
        (select max(g.created_at) from public.messages g join scope s on s.id = g.conversation_id where g.sender_agent_id = m.id and g.sender_type = 'ai') as last_active
      from m) x), '[]')
  ) into r;
  return r;
end $$;

revoke execute on function public.rpc_agent_status() from public, anon;
grant execute on function public.rpc_agent_status() to authenticated;
