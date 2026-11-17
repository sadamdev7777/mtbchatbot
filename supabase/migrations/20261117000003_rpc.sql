-- Business RPCs. Browser-callable ones check the caller with auth_* helpers;
-- internal ones (service role only) carry the non-negotiable inbox rules.

-- ---------------------------------------------------------------------------
-- Audit log trigger: records changes of selected columns with the acting member.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cols text[] := tg_argv;
  b jsonb := '{}'; a jsonb := '{}';
  c text; changed boolean := false;
  oldj jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  newj jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rec jsonb := coalesce(newj, oldj);
  actor uuid := public.auth_member_id();
begin
  if tg_op = 'UPDATE' then
    foreach c in array cols loop
      if (oldj -> c) is distinct from (newj -> c) then
        b := b || jsonb_build_object(c, oldj -> c);
        a := a || jsonb_build_object(c, newj -> c);
        changed := true;
      end if;
    end loop;
    if not changed then return new; end if;
  elsif tg_op = 'INSERT' then
    foreach c in array cols loop a := a || jsonb_build_object(c, newj -> c); end loop;
  else
    foreach c in array cols loop b := b || jsonb_build_object(c, oldj -> c); end loop;
  end if;
  insert into public.events (company_id, actor_type, actor_member_id, action, entity, entity_id, before, after)
  values ((rec ->> 'company_id')::uuid,
          case when actor is null then 'system' else 'staff' end,
          actor, lower(tg_op), tg_table_name, (rec ->> 'id')::uuid,
          nullif(b, '{}'), nullif(a, '{}'));
  return coalesce(new, old);
end $$;

create trigger audit_conversations after update on public.conversations
  for each row execute function public.audit_row('holder_type','holder_member_id','team_id','agent_id','stage','status','needs_staff');
create trigger audit_conversation_labels after insert or delete on public.conversation_labels
  for each row execute function public.audit_row('conversation_id','label_id','set_by_type','reason');
create trigger audit_knowledge after insert or update on public.knowledge_docs
  for each row execute function public.audit_row('scope','agent_id','section','version','status');
create trigger audit_members after insert or update on public.members
  for each row execute function public.audit_row('role','status','display_name','on_leave_until');
create trigger audit_team_members after insert or delete on public.team_members
  for each row execute function public.audit_row('team_id','member_id');
create trigger audit_integrations after update on public.integrations
  for each row execute function public.audit_row('status','config','secret_refs');
create trigger audit_agents after update on public.agents
  for each row execute function public.audit_row('mode','status','persona','team_id','approved_at');
create trigger audit_routing after insert or update or delete on public.routing_rules
  for each row execute function public.audit_row('type','priority','match','target_agent_id','target_team_id','enabled');

create or replace function public.audit_companies() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.settings is distinct from new.settings or old.office_hours is distinct from new.office_hours or old.name is distinct from new.name then
    insert into public.events (company_id, actor_type, actor_member_id, action, entity, entity_id, before, after)
    values (new.id, case when public.auth_member_id() is null then 'system' else 'staff' end, public.auth_member_id(),
            'update', 'companies', new.id,
            jsonb_build_object('settings', old.settings, 'office_hours', old.office_hours),
            jsonb_build_object('settings', new.settings, 'office_hours', new.office_hours));
  end if;
  return new;
end $$;
create trigger audit_companies after update on public.companies for each row execute function public.audit_companies();

-- ---------------------------------------------------------------------------
-- Notifications helper (respects nothing but membership; push/sound prefs are applied by push-send)
-- ---------------------------------------------------------------------------
create or replace function public.notify_member(p_member uuid, p_event text, p_title text, p_body text, p_link text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; cid uuid;
begin
  select company_id into cid from public.members where id = p_member and status = 'active';
  if cid is null then return null; end if;
  insert into public.notifications (company_id, member_id, event, title, body, link)
  values (cid, p_member, p_event, p_title, p_body, p_link) returning id into nid;
  return nid;
end $$;

-- ---------------------------------------------------------------------------
-- Message side-effects on the conversation
-- ---------------------------------------------------------------------------
create or replace function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare preview text;
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
    -- Stop rule: a customer reply cancels pending close-sale follow-ups.
    update public.followup_jobs set status = 'cancelled', result = 'customer_replied'
      where conversation_id = new.conversation_id and status = 'pending' and kind in ('followup','event');
    -- Broadcast reply tracking (last 7 days).
    update public.broadcast_recipients br set status = 'replied', replied_at = now()
      from public.conversations c
      where c.id = new.conversation_id and br.contact_id = c.contact_id
        and br.status in ('sent','delivered','read') and br.sent_at > now() - interval '7 days';
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
create trigger messages_side_effects after insert on public.messages for each row execute function public.on_message_insert();

-- ---------------------------------------------------------------------------
-- Internal helpers (service role)
-- ---------------------------------------------------------------------------
create or replace function public.add_system_event(p_conv uuid, p_body text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.messages (company_id, conversation_id, direction, sender_type, type, body, status, is_internal_note, meta)
  select c.company_id, c.id, 'out', 'system', 'event', p_body, 'sent', false, p_meta
  from public.conversations c where c.id = p_conv;
end $$;

create or replace function public.set_needs_staff(p_conv uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set needs_staff = true, needs_staff_reason = p_reason,
         needs_staff_since = case when needs_staff then needs_staff_since else now() end
   where id = p_conv;
  perform public.add_system_event(p_conv, 'Needs staff: ' || p_reason, jsonb_build_object('kind','needs_staff','reason',p_reason));
end $$;

create or replace function public.clear_needs_staff(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set needs_staff = false, needs_staff_reason = null, needs_staff_since = null
   where id = p_conv and needs_staff;
end $$;

-- Apply a label, enforcing single_per_chat groups (e.g. Temperature).
create or replace function public.apply_label(p_conv uuid, p_label uuid, p_by_type text, p_member uuid, p_agent uuid, p_reason text, p_confirmed boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare l public.labels; cid uuid;
begin
  select * into l from public.labels where id = p_label;
  select company_id into cid from public.conversations where id = p_conv;
  if l.id is null or cid is null or l.company_id <> cid then raise exception 'label_not_found'; end if;
  if l.single_per_chat then
    delete from public.conversation_labels cl using public.labels x
     where cl.conversation_id = p_conv and x.id = cl.label_id and x."group" = l."group" and x.id <> l.id;
  end if;
  insert into public.conversation_labels (company_id, conversation_id, label_id, set_by_type, set_by_member_id, set_by_agent_id, reason, confirmed)
  values (cid, p_conv, p_label, p_by_type, p_member, p_agent, p_reason, p_confirmed)
  on conflict (conversation_id, label_id) do update
    set set_by_type = excluded.set_by_type, set_by_member_id = excluded.set_by_member_id,
        set_by_agent_id = excluded.set_by_agent_id, reason = excluded.reason, confirmed = excluded.confirmed;
  update public.labels set last_used_at = now() where id = p_label;
end $$;

-- Rule 4: re-check right before an AI reply is sent. Locks the conversation row.
-- Returns 'ok', or the reason to discard: not_ai_holder | staff_typing | staff_sent | newer_inbound (→ re-run).
create or replace function public.ai_try_commit(p_conv uuid, p_run_started_at timestamptz, p_agent uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv for update;
  if c.id is null then return 'not_found'; end if;
  if c.holder_type <> 'ai' or c.agent_id is distinct from p_agent then return 'not_ai_holder'; end if;
  if c.staff_typing_until is not null and c.staff_typing_until > now() then return 'staff_typing'; end if;
  if exists (select 1 from public.messages m where m.conversation_id = p_conv and m.sender_type = 'staff'
             and not m.is_internal_note and m.created_at >= p_run_started_at) then return 'staff_sent'; end if;
  if exists (select 1 from public.messages m where m.conversation_id = p_conv and m.direction = 'in'
             and m.created_at > p_run_started_at) then return 'newer_inbound'; end if;
  return 'ok';
end $$;

-- Rule 3: a staff send makes that staff member the holder (AI stops). A chat held by another staff
-- member cannot be written into until taken over.
create or replace function public.staff_send_claim(p_conv uuid, p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c public.conversations; mname text;
begin
  select * into c from public.conversations where id = p_conv for update;
  if c.id is null then return 'not_found'; end if;
  if c.holder_type = 'staff' and c.holder_member_id <> p_member then return 'held_by_other'; end if;
  if c.holder_type <> 'staff' then
    select display_name into mname from public.members where id = p_member;
    update public.conversations set holder_type = 'staff', holder_member_id = p_member, holder_since = now()
     where id = p_conv;
    perform public.add_system_event(p_conv, mname || ' took over the chat by replying',
      jsonb_build_object('kind','holder','holder_type','staff','member_id',p_member));
    update public.followup_jobs set status = 'cancelled', result = 'staff_holds'
     where conversation_id = p_conv and status = 'pending' and kind = 'followup';
  end if;
  perform public.clear_needs_staff(p_conv);
  update public.ai_drafts set status = 'superseded' where conversation_id = p_conv and status = 'pending';
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- Browser RPCs
-- ---------------------------------------------------------------------------
create or replace function public.require_conversation(p_conv uuid) returns public.conversations
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conv;
  if c.id is null or not public.can_see_conversation(c.company_id, c.team_id, c.holder_member_id) then
    raise exception 'conversation_not_found' using errcode = '42501';
  end if;
  return c;
end $$;

create or replace function public.rpc_take_over(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations; me uuid := public.auth_member_id(); mname text;
begin
  c := public.require_conversation(p_conv);
  perform 1 from public.conversations where id = p_conv for update;
  select display_name into mname from public.members where id = me;
  update public.conversations set holder_type = 'staff', holder_member_id = me, holder_since = now()
   where id = p_conv;
  perform public.clear_needs_staff(p_conv);
  update public.followup_jobs set status = 'cancelled', result = 'staff_holds'
   where conversation_id = p_conv and status = 'pending' and kind = 'followup';
  perform public.add_system_event(p_conv, mname || ' took over', jsonb_build_object('kind','holder','holder_type','staff','member_id',me));
end $$;

create or replace function public.rpc_return_to_bot(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations; mname text;
begin
  c := public.require_conversation(p_conv);
  if c.agent_id is null then raise exception 'no_agent_for_chat'; end if;
  select display_name into mname from public.members where id = public.auth_member_id();
  update public.conversations set holder_type = 'ai', holder_member_id = null, holder_since = now(), staff_typing_until = null
   where id = p_conv;
  perform public.add_system_event(p_conv, mname || ' returned the chat to the bot', jsonb_build_object('kind','holder','holder_type','ai'));
end $$;

create or replace function public.rpc_assign(p_conv uuid, p_member uuid, p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations; me uuid := public.auth_member_id(); tname text; mname text;
begin
  c := public.require_conversation(p_conv);
  if not (public.auth_has_role(array['owner','admin','team_lead']) or c.holder_member_id = me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_member is not null and not exists (select 1 from public.members where id = p_member and company_id = c.company_id and status = 'active') then
    raise exception 'member_not_found';
  end if;
  if p_team is not null and not exists (select 1 from public.teams where id = p_team and company_id = c.company_id) then
    raise exception 'team_not_found';
  end if;
  update public.conversations set
    team_id = coalesce(p_team, team_id),
    holder_type = case when p_member is not null then 'staff' else holder_type end,
    holder_member_id = case when p_member is not null then p_member else holder_member_id end,
    holder_since = case when p_member is not null then now() else holder_since end
  where id = p_conv;
  select name into tname from public.teams where id = p_team;
  select display_name into mname from public.members where id = p_member;
  perform public.add_system_event(p_conv,
    'Assigned to ' || coalesce(mname, '') || case when tname is not null then ' (' || tname || ')' else '' end,
    jsonb_build_object('kind','assign','member_id',p_member,'team_id',p_team));
  if p_member is not null and p_member <> me then
    perform public.notify_member(p_member,
      case when c.needs_staff then 'needs_staff_assigned' else 'chat_assigned' end,
      'Chat assigned to you', coalesce(c.needs_staff_reason, c.last_message_preview), '/inbox?c=' || p_conv);
  end if;
end $$;

create or replace function public.rpc_close(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  update public.conversations set status = 'closed', closed_at = now(), needs_staff = false,
         needs_staff_reason = null, needs_staff_since = null where id = p_conv;
  perform public.add_system_event(p_conv, 'Chat closed', jsonb_build_object('kind','status','status','closed'));
end $$;

create or replace function public.rpc_reopen(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  update public.conversations set status = 'open', closed_at = null where id = p_conv;
  perform public.add_system_event(p_conv, 'Chat reopened', jsonb_build_object('kind','status','status','open'));
end $$;

-- Rule 3: staff typing blocks the AI for 2 minutes.
create or replace function public.rpc_set_typing(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  update public.conversations set staff_typing_until = now() + interval '2 minutes' where id = p_conv;
end $$;

create or replace function public.rpc_add_note(p_conv uuid, p_body text, p_mentions uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.conversations; me uuid := public.auth_member_id(); mid uuid; m uuid; mname text;
begin
  c := public.require_conversation(p_conv);
  if coalesce(trim(p_body), '') = '' then raise exception 'empty_note'; end if;
  insert into public.messages (company_id, conversation_id, direction, sender_type, sender_member_id, type, body, status, is_internal_note, meta)
  values (c.company_id, p_conv, 'out', 'staff', me, 'note', p_body, 'sent', true, jsonb_build_object('mentions', p_mentions))
  returning id into mid;
  select display_name into mname from public.members where id = me;
  foreach m in array coalesce(p_mentions, '{}') loop
    if m <> me then
      perform public.notify_member(m, 'mentioned', mname || ' mentioned you', left(p_body, 140), '/inbox?c=' || p_conv);
    end if;
  end loop;
  return mid;
end $$;

create or replace function public.rpc_set_label(p_conv uuid, p_label uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  perform public.apply_label(p_conv, p_label, 'staff', public.auth_member_id(), null, p_reason, true);
end $$;

create or replace function public.rpc_remove_label(p_conv uuid, p_label uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  delete from public.conversation_labels where conversation_id = p_conv and label_id = p_label;
end $$;

create or replace function public.rpc_set_stage(p_conv uuid, p_stage text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  c := public.require_conversation(p_conv);
  update public.conversations set stage = p_stage where id = p_conv;
  perform public.add_system_event(p_conv, 'Stage changed to ' || p_stage, jsonb_build_object('kind','stage','stage',p_stage));
end $$;

-- Record what staff did with an AI draft (night job learns from edits).
create or replace function public.rpc_draft_decision(p_draft uuid, p_decision text, p_final text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.ai_drafts;
begin
  select * into d from public.ai_drafts where id = p_draft;
  if d.id is null then raise exception 'draft_not_found'; end if;
  perform public.require_conversation(d.conversation_id);
  if p_decision not in ('used','edited','discarded') then raise exception 'bad_decision'; end if;
  update public.ai_drafts set status = p_decision, final_text = p_final, decided_by = public.auth_member_id(), decided_at = now()
   where id = p_draft;
end $$;

create or replace function public.rpc_touch_presence() returns void
language sql security definer set search_path = public as $$
  update public.members set last_seen_at = now() where id = public.auth_member_id()
$$;

-- Who am I (used by the app shell). Returns nothing for owners/admins until 2-step is done.
create or replace function public.rpc_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'member_id', m.id, 'company_id', m.company_id, 'role', m.role, 'display_name', m.display_name,
    'email', m.email, 'company_name', c.name, 'team_ids', public.auth_team_ids())
  from public.members m join public.companies c on c.id = m.company_id
  where m.id = public.auth_member_id()
$$;

-- Pre-2-step lookup: tells the login page whether the user must verify a code.
create or replace function public.rpc_login_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', m.role, 'status', m.status,
    'needs_2fa', m.role in ('owner','admin') and coalesce((c.settings ->> 'require_2fa')::boolean, true)
                 and not public.auth_session_verified())
  from public.members m join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Grants: internal functions are service-role only.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['notify_member(uuid,text,text,text,text)','add_system_event(uuid,text,jsonb)',
    'set_needs_staff(uuid,text)','clear_needs_staff(uuid)',
    'apply_label(uuid,uuid,text,uuid,uuid,text,boolean)','ai_try_commit(uuid,timestamptz,uuid)',
    'staff_send_claim(uuid,uuid)','audit_row()','audit_companies()','on_message_insert()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
