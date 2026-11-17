-- Morning report decisions: approve (apply), reject, roll back auto-applied changes.

create or replace function public.rpc_decide_suggestion(p_id uuid, p_decision text, p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.suggestions; pl jsonb; me uuid := public.auth_member_id(); ref jsonb := '{}'; oa uuid;
begin
  select * into s from public.suggestions where id = p_id for update;
  if s.id is null or s.company_id <> public.auth_company_id() then raise exception 'not_found'; end if;
  if not (public.auth_is_admin() or (public.auth_has_role(array['team_lead']) and s.team_id = any(public.auth_team_ids()) and s.kind = 'staff')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  pl := coalesce(p_payload, s.payload);

  if p_decision = 'reject' then
    update public.suggestions set status = 'rejected', decided_by = me, decided_at = now(), payload = pl where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;

  if p_decision = 'rollback' then
    if not s.auto_applied or s.applied_ref is null then raise exception 'nothing_to_roll_back'; end if;
    if s.applied_ref ? 'knowledge_doc_id' then
      perform public.rollback_knowledge(s.company_id, s.applied_ref ->> 'scope', null, s.applied_ref ->> 'section', me);
    elsif s.applied_ref ? 'official_answer_id' then
      update public.official_answers set status = 'archived' where id = (s.applied_ref ->> 'official_answer_id')::uuid;
    end if;
    update public.suggestions set status = 'rolled_back', decided_by = me, decided_at = now() where id = p_id;
    return jsonb_build_object('status', 'rolled_back');
  end if;

  if p_decision <> 'approve' then raise exception 'bad_decision'; end if;
  case s.kind
    when 'official_answer', 'question' then
      if coalesce(pl ->> 'answer', '') = '' then raise exception 'answer_required'; end if;
      insert into public.official_answers (company_id, scope, agent_id, question, answer, source)
      values (s.company_id, case when pl ->> 'agent_id' is null then 'company' else 'agent' end, (pl ->> 'agent_id')::uuid, pl ->> 'question', pl ->> 'answer',
              case when s.kind = 'question' then 'owner' else 'night_job' end)
      returning id into oa;
      ref := jsonb_build_object('official_answer_id', oa);
    when 'style', 'knowledge' then
      perform public.activate_knowledge((pl ->> 'doc_id')::uuid, me);
      ref := jsonb_build_object('knowledge_doc_id', pl ->> 'doc_id');
    when 'staff' then
      if pl ->> 'action' = 'reassign' and pl ->> 'member_id' is not null then
        update public.conversations set holder_type = 'staff', holder_member_id = (pl ->> 'member_id')::uuid, holder_since = now()
         where id = (pl ->> 'conversation_id')::uuid;
        perform public.add_system_event((pl ->> 'conversation_id')::uuid, 'Reassigned from the morning report', jsonb_build_object('kind','assign','member_id', pl ->> 'member_id'));
        perform public.notify_member((pl ->> 'member_id')::uuid, 'needs_staff_assigned', 'Chat assigned to you', pl ->> 'reason', '/inbox?c=' || (pl ->> 'conversation_id'));
      end if;
    when 'label' then
      delete from public.labels where id = (pl ->> 'label_id')::uuid and company_id = s.company_id;
    else null; -- rules are applied by an admin in the Router; approving records the decision
  end case;
  update public.suggestions set status = 'approved', decided_by = me, decided_at = now(), payload = pl, applied_ref = coalesce(applied_ref, '{}'::jsonb) || ref where id = p_id;
  return jsonb_build_object('status', 'approved');
end $$;

-- Night-job permissions live in companies.settings.night_job_permissions (owner/admin edit them on the Night job tab).

-- Company-scope docs have agent_id null: versions must still be unique per section.
alter table public.knowledge_docs drop constraint knowledge_docs_company_id_scope_agent_id_section_version_key;
alter table public.knowledge_docs add constraint knowledge_docs_version_unique unique nulls not distinct (company_id, scope, agent_id, section, version);
