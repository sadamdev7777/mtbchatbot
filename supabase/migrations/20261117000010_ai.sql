-- AI core: official-answer matching, spend tracking + cap, knowledge versions.

-- Official answers: trigram similarity over the question and its variants (agent answers first).
create or replace function public.match_official_answer(p_company uuid, p_agent uuid, p_question text)
returns table (id uuid, question text, answer text, score real)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  select oa.id, oa.question, oa.answer,
    greatest(similarity(lower(oa.question), lower(p_question)),
             coalesce((select max(similarity(lower(v), lower(p_question))) from unnest(oa.variants) v), 0),
             word_similarity(lower(oa.question), lower(p_question))) as score
  from public.official_answers oa
  where oa.company_id = p_company and oa.status = 'active'
    and (oa.scope = 'company' or oa.agent_id = p_agent)
  order by (oa.agent_id is not null) desc, 4 desc
  limit 3;
end $$;

-- The top matches above a threshold, used in prompts (not all answers are pasted).
create or replace function public.top_official_answers(p_company uuid, p_agent uuid, p_question text, p_limit int default 5)
returns table (id uuid, question text, answer text, score real)
language sql stable security definer set search_path = public, extensions as $$
  select * from (
    select oa.id, oa.question, oa.answer,
      greatest(similarity(lower(oa.question), lower(p_question)), word_similarity(lower(oa.question), lower(p_question)),
               coalesce((select max(word_similarity(lower(v), lower(p_question))) from unnest(oa.variants) v), 0))::real as score
    from public.official_answers oa
    where oa.company_id = p_company and oa.status = 'active' and (oa.scope = 'company' or oa.agent_id = p_agent)
  ) x where x.score >= 0.25 order by x.score desc limit p_limit
$$;

create or replace function public.bump_official_answer(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.official_answers set usage_count = usage_count + 1 where id = p_id
$$;

-- Spend (RM) for the current month; returns the new total.
create or replace function public.add_spend(p_company uuid, p_provider text, p_amount numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare m date := (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur'))::date; total numeric;
begin
  insert into public.spend (company_id, month, provider, amount) values (p_company, m, p_provider, p_amount)
  on conflict (company_id, month, provider) do update set amount = public.spend.amount + excluded.amount
  returning amount into total;
  return total;
end $$;

create or replace function public.claude_cap_state(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'spent_rm', coalesce((select amount from public.spend where company_id = p_company and provider = 'claude'
                          and month = (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur'))::date), 0),
    'cap_rm', coalesce((select (config ->> 'monthly_cap_rm')::numeric from public.integrations where company_id = p_company and key = 'claude'),
                       (select (settings ->> 'claude_monthly_cap_rm')::numeric from public.companies where id = p_company)))
$$;

-- ---------------------------------------------------------------------------
-- Knowledge versions: exactly one active version per (scope, agent, section)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_save_knowledge(p_scope text, p_agent uuid, p_section text, p_content text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid := public.auth_company_id(); v int; nid uuid;
begin
  if not public.auth_is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v from public.knowledge_docs
   where company_id = cid and scope = p_scope and agent_id is not distinct from p_agent and section = p_section;
  insert into public.knowledge_docs (company_id, scope, agent_id, section, version, status, content, source, created_by)
  values (cid, p_scope, p_agent, p_section, v, 'draft', p_content, 'staff', public.auth_member_id()) returning id into nid;
  return nid;
end $$;

-- Activate a version (service role or admin). The previous active version is archived (kept for rollback).
create or replace function public.activate_knowledge(p_doc uuid, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.knowledge_docs;
begin
  select * into d from public.knowledge_docs where id = p_doc for update;
  if d.id is null then raise exception 'not_found'; end if;
  update public.knowledge_docs set status = 'archived'
   where company_id = d.company_id and scope = d.scope and agent_id is not distinct from d.agent_id and section = d.section and status = 'active' and id <> d.id;
  update public.knowledge_docs set status = 'active', activated_at = now(), activated_by = p_member where id = d.id;
end $$;

create or replace function public.rpc_activate_knowledge(p_doc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.knowledge_docs;
begin
  select * into d from public.knowledge_docs where id = p_doc;
  if d.id is null or d.company_id <> public.auth_company_id() or not public.auth_is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform public.activate_knowledge(p_doc, public.auth_member_id());
end $$;

-- Roll back: re-activate the newest archived version of the same section.
create or replace function public.rollback_knowledge(p_company uuid, p_scope text, p_agent uuid, p_section text, p_member uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare prev uuid;
begin
  select id into prev from public.knowledge_docs
   where company_id = p_company and scope = p_scope and agent_id is not distinct from p_agent and section = p_section and status = 'archived'
   order by version desc limit 1;
  if prev is null then raise exception 'nothing_to_roll_back'; end if;
  perform public.activate_knowledge(prev, p_member);
  return prev;
end $$;

create or replace function public.rpc_rollback_knowledge(p_scope text, p_agent uuid, p_section text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return public.rollback_knowledge(public.auth_company_id(), p_scope, p_agent, p_section, public.auth_member_id());
end $$;

-- Agents may only go live with the owner's approval after 25/25 scenarios pass (enforced again in the wizard).
create or replace function public.rpc_approve_agent(p_agent uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.agents; passed int; total int; batch uuid;
begin
  select * into a from public.agents where id = p_agent;
  if a.id is null or a.company_id <> public.auth_company_id() then raise exception 'not_found'; end if;
  if not public.auth_has_role(array['owner']) then raise exception 'only_owner_approves_go_live' using errcode = '42501'; end if;
  select tr.batch_id into batch from public.test_runs tr where tr.agent_id = p_agent and tr.context = 'go_live' order by tr.created_at desc limit 1;
  select count(*) filter (where passed), count(*) into passed, total from public.test_runs where batch_id = batch;
  if batch is null or total < 25 or passed < total then raise exception 'needs_25_of_25 (% of % passed)', coalesce(passed, 0), coalesce(total, 0); end if;
  update public.agents set status = 'live', mode = p_mode, approved_by = public.auth_member_id(), approved_at = now() where id = p_agent;
end $$;

do $$
declare f text;
begin
  foreach f in array array['match_official_answer(uuid,uuid,text)','top_official_answers(uuid,uuid,text,int)','bump_official_answer(uuid)',
    'add_spend(uuid,text,numeric)','claude_cap_state(uuid)','activate_knowledge(uuid,uuid)','rollback_knowledge(uuid,text,uuid,text,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

alter table public.agents add column destination text;
