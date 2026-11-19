begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
insert into public.mfa_codes (company_id, user_id, session_id, code_hash, expires_at, verified_at)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000000','x', now(), now());
create temp table t as select c.id, c.contact_id from public.conversations c limit 1;
grant select on t to authenticated;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.rpc_erase_contact((select contact_id from t)) $$, '42501', null, 'staff cannot erase');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"99999999-0000-0000-0000-000000000000"}', true);
select lives_ok($$ select public.rpc_erase_contact((select contact_id from t)) $$, 'owner erases a contact');
select is((select count(*) from public.contacts where id = (select contact_id from t))::int, 0, 'contact gone');
select is((select count(*) from public.conversations where id = (select id from t))::int, 0, 'chats gone');
select is((select count(*) from public.messages where conversation_id = (select id from t))::int, 0, 'messages gone');
select throws_ok($$ select public.rpc_erase_contact((select contact_id from t)) $$, 'P0002', null, 'second erase: not found');
select * from finish();
rollback;
