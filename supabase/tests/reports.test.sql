begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
insert into public.mfa_codes (company_id, user_id, session_id, code_hash, expires_at, verified_at)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000000','x', now(), now());
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"99999999-0000-0000-0000-000000000000"}', true);
select ok((public.rpc_dashboard(now() - interval '2 days', now() + interval '1 minute') ->> 'incoming_chats')::int >= 3, 'owner dashboard counts the seeded chats');
select is(jsonb_array_length(public.rpc_dashboard(now() - interval '2 days', now()) -> 'funnel'), 4, 'funnel has 4 steps');
select ok(public.rpc_reports(now() - interval '30 days', now()) ? 'claude_by_model', 'owner sees cost');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.rpc_reports(now() - interval '30 days', now()) -> 'claude_by_model', '[]'::jsonb, 'team lead does not see cost');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.rpc_dashboard(now() - interval '1 day', now()) $$, '42501', null, 'accounts has no dashboard');
select * from finish();
rollback;
