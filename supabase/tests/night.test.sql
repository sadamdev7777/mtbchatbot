begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.mfa_codes (company_id, user_id, session_id, code_hash, expires_at, verified_at)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000000','x', now(), now());
insert into public.night_reports (id, company_id, report_date) values ('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001', current_date);
insert into public.suggestions (id, company_id, night_report_id, kind, title, payload) values
 ('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','question','Boleh bawa stroller?','{"question":"Boleh bawa stroller?","agent_id":null}'),
 ('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','rule','Add keyword mabul','{}');
-- an auto-applied style change to roll back
insert into public.knowledge_docs (id, company_id, scope, section, version, status, content, source)
values ('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','company','language_style',2,'draft','new style','night_job');
select public.activate_knowledge('82000000-0000-0000-0000-000000000001', null);
insert into public.suggestions (id, company_id, night_report_id, kind, title, payload, status, auto_applied, applied_ref) values
 ('81000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','style','Style v2','{}','approved',true,
  '{"knowledge_doc_id":"82000000-0000-0000-0000-000000000001","scope":"company","section":"language_style"}');

-- staff cannot decide
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.rpc_decide_suggestion('81000000-0000-0000-0000-000000000002', 'approve', null) $$, '42501', null, 'staff cannot approve suggestions');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"99999999-0000-0000-0000-000000000000"}', true);
select throws_ok($$ select public.rpc_decide_suggestion('81000000-0000-0000-0000-000000000001', 'approve', null) $$, 'P0001', 'answer_required', 'a question needs an answer');
select lives_ok($$ select public.rpc_decide_suggestion('81000000-0000-0000-0000-000000000001', 'approve', '{"question":"Boleh bawa stroller?","answer":"Boleh cik.","agent_id":null}') $$, 'owner answers a question');
select lives_ok($$ select public.rpc_decide_suggestion('81000000-0000-0000-0000-000000000003', 'rollback', null) $$, 'owner rolls back a direct change');

select set_config('role', 'postgres', true);
select is((select answer from public.official_answers where question = 'Boleh bawa stroller?'), 'Boleh cik.', 'answer typed in the report becomes an official answer');
select is((select version from public.knowledge_docs where company_id = '00000000-0000-0000-0000-000000000001' and section = 'language_style' and status = 'active'), 1, 'rollback re-activates the previous version');

select * from finish();
rollback;
