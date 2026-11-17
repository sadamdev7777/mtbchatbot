-- System health: remember which function each pg_cron call went to, and alert owners in the app
-- (and by push) when background functions fail. At most one alert per owner per hour.

create table public.edge_calls (
  request_id bigint primary key,
  fn text not null,
  created_at timestamptz not null default now()
);
alter table public.edge_calls enable row level security; -- service only, no policies
create index on public.edge_calls (created_at);

create or replace function public.call_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, vault, extensions as $$
declare base text; key text; anon text; rid bigint; hdrs jsonb;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'edge_internal_key';
  select decrypted_secret into anon from vault.decrypted_secrets where name = 'edge_anon_key';
  if base is null or key is null then return null; end if;
  hdrs := jsonb_build_object('content-type', 'application/json', 'x-internal-key', key);
  if anon is not null then hdrs := hdrs || jsonb_build_object('authorization', 'Bearer ' || anon); end if;
  select net.http_post(url := base || '/' || p_name, body := p_body, headers := hdrs, timeout_milliseconds := 55000) into rid;
  insert into public.edge_calls (request_id, fn) values (rid, p_name) on conflict do nothing;
  return rid;
end $$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Failed background calls in the window, per function (the message is generic: no tenant data).
create or replace function public.system_health(p_minutes int default 15)
returns table (fn text, failures bigint, last_status text, last_at timestamptz)
language sql stable security definer set search_path = public, net as $$
  select c.fn, count(*),
         (array_agg(coalesce(r.status_code::text, case when r.timed_out then 'timeout' else 'error' end) order by r.created desc))[1],
         max(r.created)
  from public.edge_calls c
  join net._http_response r on r.id = c.request_id
  where r.created > now() - make_interval(mins => p_minutes)
    and c.fn <> 'push-send'
    and (r.timed_out or r.error_msg is not null or r.status_code is null or r.status_code >= 500 or r.status_code in (401, 403, 404))
  group by c.fn
$$;
revoke execute on function public.system_health(int) from public, anon, authenticated;

create or replace function public.system_health_alert() returns int
language plpgsql security definer set search_path = public as $$
declare body text; n int := 0; m record;
begin
  delete from public.edge_calls where created_at < now() - interval '2 days';
  select string_agg(format('%s failed %s× (last: %s)', fn, failures, last_status), '; ' order by fn) into body
  from public.system_health(15) where failures >= 2;
  if body is null then return 0; end if;
  for m in select id from public.members where role = 'owner' and status = 'active' loop
    if not exists (select 1 from public.notifications where member_id = m.id and event = 'system_error' and created_at > now() - interval '1 hour') then
      perform public.notify_member(m.id, 'system_error', 'Background jobs are failing',
        'In the last 15 minutes: ' || body || '. Follow-ups, AI replies or payments may be delayed. Check Supabase › Edge Functions › Logs.', '/settings/integrations');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.system_health_alert() from public, anon, authenticated;

select cron.schedule('system-health', '*/10 * * * *', $$select public.system_health_alert()$$);
