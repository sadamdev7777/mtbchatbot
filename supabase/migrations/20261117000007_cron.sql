-- Schedules. pg_cron calls Edge Functions through pg_net with two Vault secrets set once per environment:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'edge_functions_url');
--   select vault.create_secret('<INTERNAL_KEY value>', 'edge_internal_key');
-- Without them the calls are skipped (local dev runs the jobs by hand or through tests).

create or replace function public.call_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, vault, extensions as $$
declare base text; key text; rid bigint;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'edge_functions_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'edge_internal_key';
  if base is null or key is null then return null; end if;
  select net.http_post(
    url := base || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('content-type', 'application/json', 'x-internal-key', key),
    timeout_milliseconds := 55000
  ) into rid;
  return rid;
end $$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

select cron.schedule('followup-runner', '* * * * *', $$select public.call_edge_function('followup-runner')$$);
select cron.schedule('ai-sweeper', '* * * * *', $$select public.call_edge_function('ai-orchestrator', '{"action":"sweep"}')$$);
select cron.schedule('templates-sync', '*/15 * * * *', $$select public.call_edge_function('templates-sync')$$);
select cron.schedule('bank-email-poller', '*/5 * * * *', $$select public.call_edge_function('bank-email-poller')$$);
-- Night job: 00:00–06:00 Asia/Kuala_Lumpur = 16:00–22:00 UTC, one phase per hour.
select cron.schedule('night-job', '0 16-22 * * *', $$select public.call_edge_function('night-job', '{"action":"phase"}')$$);
