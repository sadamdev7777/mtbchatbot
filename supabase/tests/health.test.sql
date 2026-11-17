begin;
select plan(6);

-- two failed and one good background call in the last minutes
insert into net._http_response (id, status_code, content, created) values (990001, 500, 'boom', now()), (990002, 503, 'down', now()), (990003, 200, 'ok', now());
insert into public.edge_calls (request_id, fn) values (990001, 'followup-runner'), (990002, 'followup-runner'), (990003, 'ai-orchestrator');

select is((select failures from public.system_health(15) where fn = 'followup-runner'), 2::bigint, 'failed calls are counted per function');
select is((select count(*) from public.system_health(15) where fn = 'ai-orchestrator'), 0::bigint, 'successful calls are not failures');

select is(public.system_health_alert(), 1, 'the owner is alerted');
select ok(exists (select 1 from public.notifications where event = 'system_error' and member_id = '20000000-0000-0000-0000-000000000001' and body like '%followup-runner failed 2×%'), 'alert names the failing function');
select is(public.system_health_alert(), 0, 'no second alert within the hour');

set local role authenticated;
select throws_ok('select public.system_health_alert()', '42501', null, 'browsers cannot run the health check');

select * from finish();
rollback;
