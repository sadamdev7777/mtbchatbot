begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- helper to act as a seeded user (u = last digit of the seeded user id)
create or replace function pg_temp.act_as(u int, sess uuid default '99999999-0000-0000-0000-000000000000') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '10000000-0000-0000-0000-00000000000' || u, 'role', 'authenticated', 'session_id', sess)::text, true);
end $$;
create or replace function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------- owner: needs 2-step ----------
select pg_temp.act_as(1);
select is((select count(*) from public.conversations)::int, 0, 'owner without 2-step sees nothing');
select is((select public.rpc_login_state() ->> 'needs_2fa'), 'true', 'owner login state says 2-step needed');
select pg_temp.reset_role();
insert into public.mfa_codes (company_id, user_id, session_id, code_hash, expires_at, verified_at)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000000','x', now(), now()),
       ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','99999999-0000-0000-0000-000000000000','x', now(), now());
select pg_temp.act_as(1);
select is((select count(*) from public.conversations)::int, 3, 'owner after 2-step sees all chats');
select is((select count(*) from public.events)::int > 0, true, 'owner reads activity log');
select is((select count(*) from public.integrations)::int, 9, 'owner reads integrations');
select lives_ok($$ update public.integrations set config = '{"x":1}' where key = 'hrboost' $$, 'owner updates integration');
select pg_temp.act_as(1, '88888888-0000-0000-0000-000000000000');
select is((select count(*) from public.conversations)::int, 0, 'owner in another (unverified) session sees nothing');

-- ---------- admin ----------
select pg_temp.act_as(2);
select is((select count(*) from public.conversations)::int, 3, 'admin sees all chats');
update public.integrations set config = '{"hacked":1}' where key = 'hrboost';
select pg_temp.reset_role();
select is((select config ->> 'hacked' from public.integrations where key = 'hrboost'), null, 'admin cannot change integrations');
select pg_temp.act_as(2);
select is((select count(*) from public.payment_verifications)::int, 0, 'admin can view payment verifications (none yet)');

-- ---------- team lead (Sabah) ----------
select pg_temp.act_as(3);
select is((select count(*) from public.conversations)::int, 3, 'team lead sees own team + unassigned');
select is((select count(*) from public.events)::int, 0, 'team lead cannot read the activity log');
select is((select count(*) from public.integrations)::int, 0, 'team lead cannot read integrations');
select is((select count(*) from public.knowledge_docs)::int > 0, true, 'team lead views knowledge');
select throws_ok($$ insert into public.templates (company_id, name, status) values ('00000000-0000-0000-0000-000000000001','lead_try','APPROVED') $$,
  '42501', null, 'team lead cannot create an approved template');
select lives_ok($$ insert into public.templates (company_id, name, status) values ('00000000-0000-0000-0000-000000000001','lead_suggest','SUGGESTED') $$,
  'team lead can suggest a template');

-- ---------- staff Hakim (Overseas + General) ----------
select pg_temp.act_as(5);
select is((select count(*) from public.conversations)::int, 1, 'staff outside Sabah sees only unassigned chat');
select is((select count(*) from public.messages where conversation_id = '70000000-0000-0000-0000-000000000001')::int, 0, 'staff cannot read messages of other team');
select throws_ok($$ select public.rpc_take_over('70000000-0000-0000-0000-000000000001') $$, '42501', null, 'staff cannot take over a chat they cannot see');
select is((select count(*) from public.knowledge_docs)::int, 0, 'staff cannot read knowledge');
update public.labels set name = 'X' where name = 'HOT';
select throws_ok($$ select public.ai_try_commit('70000000-0000-0000-0000-000000000001', now(), null) $$, '42501', null, 'internal functions are not callable by users');

-- ---------- staff Farah (Sabah) ----------
select pg_temp.act_as(4);
select is((select count(*) from public.conversations)::int, 3, 'Sabah staff sees Sabah + unassigned');
select lives_ok($$ select public.rpc_take_over('70000000-0000-0000-0000-000000000001') $$, 'staff takes over a visible chat');
select is((select holder_type || ':' || needs_staff from public.conversations where id = '70000000-0000-0000-0000-000000000001'), 'staff:false', 'take over makes staff holder and clears needs staff');

-- ---------- accounts ----------
select pg_temp.act_as(6);
select is((select count(*) from public.conversations)::int, 0, 'accounts has no inbox');
select is((select count(*) from public.contacts)::int, 0, 'accounts has no contacts');

-- ---------- internal rules as service role ----------
select pg_temp.reset_role();
select is((select name from public.labels where name = 'HOT'), 'HOT', 'staff could not rename labels');
select is(public.staff_send_claim('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'), 'held_by_other', 'second staff cannot send into a chat held by someone else');
update public.conversations set holder_type = 'ai', holder_member_id = null, staff_typing_until = now() + interval '2 minutes'
 where id = '70000000-0000-0000-0000-000000000001';
select is(public.ai_try_commit('70000000-0000-0000-0000-000000000001', now() - interval '1 minute', '50000000-0000-0000-0000-000000000001'), 'staff_typing', 'AI blocked while staff is typing');
update public.conversations set staff_typing_until = null where id = '70000000-0000-0000-0000-000000000001';
insert into public.messages (company_id, conversation_id, direction, sender_type, type, body, status)
values ('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','in','customer','text','one more thing','received');
select is(public.ai_try_commit('70000000-0000-0000-0000-000000000001', now() - interval '1 minute', '50000000-0000-0000-0000-000000000001'), 'newer_inbound', 'newer customer message forces a re-run');
select is(public.ai_try_commit('70000000-0000-0000-0000-000000000001', now() + interval '1 second', '50000000-0000-0000-0000-000000000001'), 'ok', 'AI may send when nothing changed');
-- Temperature is single per chat
select public.apply_label('70000000-0000-0000-0000-000000000001', (select id from public.labels where name = 'COLD'), 'staff', null, null, null, true);
select is((select count(*) from public.conversation_labels cl join public.labels l on l.id = cl.label_id
           where cl.conversation_id = '70000000-0000-0000-0000-000000000001' and l."group" = 'temperature')::int, 1, 'only one temperature label per chat');

select * from finish();
rollback;
