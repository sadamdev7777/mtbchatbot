-- WhatsApp core helpers: send rate limiter, template usage.

create table public.send_rate (
  channel_id uuid not null references public.channels(id) on delete cascade,
  second timestamptz not null,
  count int not null default 0,
  primary key (channel_id, second)
);
alter table public.send_rate enable row level security;

-- Fixed-window limiter (per second, per channel). Returns false when over the limit.
create or replace function public.take_send_token(p_channel uuid, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int; s timestamptz := date_trunc('second', clock_timestamp());
begin
  insert into public.send_rate (channel_id, second, count) values (p_channel, s, 1)
  on conflict (channel_id, second) do update set count = public.send_rate.count + 1
  returning count into n;
  if random() < 0.01 then delete from public.send_rate where second < now() - interval '1 minute'; end if;
  return n <= p_limit;
end $$;

-- "Used by": follow-up steps, after-sales schedule, broadcasts, night-job report.
create or replace function public.recompute_template_usage(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.templates t set used_by = coalesce((
    select array_agg(distinct u) from (
      select 'followup:' || f.key as u from public.followup_steps f where f.company_id = p_company and f.template_name = t.name and f.enabled
      union all
      select 'aftersales:' || a.key from public.aftersales_schedule a where a.company_id = p_company and a.template_name = t.name and a.enabled
      union all
      select 'broadcast:' || b.name from public.broadcasts b where b.company_id = p_company and b.template_name = t.name and b.status in ('draft','scheduled','sending')
      union all
      select 'night_job:morning_report' where t.name = 'laporan_pagi_v1'
      union all
      select 'event:seat.lock_expired' where t.name = 'seat_dilepaskan_v1'
    ) x), '{}')
  where t.company_id = p_company;
end $$;

-- Block deleting a template that is in use.
create or replace function public.block_template_delete() returns trigger
language plpgsql as $$
begin
  if coalesce(array_length(old.used_by, 1), 0) > 0 then
    raise exception 'template_in_use: % is used by %', old.name, array_to_string(old.used_by, ', ') using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger templates_block_delete before delete on public.templates for each row execute function public.block_template_delete();

do $$
declare f text;
begin
  foreach f in array array['take_send_token(uuid,int)','recompute_template_usage(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Non-secret integration status for any member (inbox needs to know e.g. whether TravelBoost is connected).
create or replace function public.rpc_integration_flags() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, status), '{}'::jsonb) from public.integrations where company_id = public.auth_company_id()
$$;
