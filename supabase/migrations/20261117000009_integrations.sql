-- Integration helpers + persistent state for mock providers (TravelBoost, bank inbox, HRBoost) so
-- the whole system runs end to end without external services.

create table public.mock_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,          -- tb_lock | tb_booking | tb_payment | bank_email | hr_leave
  ref text not null,           -- external id (lock id, booking id, …)
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, kind, ref)
);
alter table public.mock_state enable row level security; -- service role only
create trigger set_updated_at before update on public.mock_state for each row execute function public.set_updated_at();

-- Service-only secret writer (used for generated VAPID keys).
create or replace function public.service_set_integration_secret(p_company uuid, p_key text, p_field text, p_value text)
returns text language plpgsql security definer set search_path = public, vault as $$
declare integ public.integrations; ref jsonb; sid uuid; sname text := format('int:%s:%s:%s', p_company, p_key, p_field);
begin
  select * into integ from public.integrations where company_id = p_company and key = p_key for update;
  ref := integ.secret_refs -> p_field;
  if ref is not null and exists (select 1 from vault.secrets where id = (ref ->> 'id')::uuid) then
    sid := (ref ->> 'id')::uuid;
    perform vault.update_secret(sid, p_value, sname, 'MTB Inbox integration secret');
  else
    sid := vault.create_secret(p_value, sname, 'MTB Inbox integration secret');
  end if;
  update public.integrations set secret_refs = secret_refs || jsonb_build_object(p_field, jsonb_build_object('id', sid, 'last4', right(p_value, 4), 'updated_at', now()))
   where id = integ.id;
  return right(p_value, 4);
end $$;
revoke execute on function public.service_set_integration_secret(uuid, text, text, text) from public, anon, authenticated;

-- Meta config also updates the channel row the webhook matches on.
create or replace function public.sync_channel_from_meta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.key = 'meta_whatsapp' and (new.config ->> 'phone_number_id') is not null then
    update public.channels set phone_number_id = new.config ->> 'phone_number_id',
      waba_id = coalesce(new.config ->> 'waba_id', waba_id),
      phone_display = coalesce(new.config ->> 'display_phone', phone_display)
    where id = (select id from public.channels where company_id = new.company_id order by created_at limit 1);
  end if;
  return new;
end $$;
create trigger integrations_sync_channel after update of config on public.integrations for each row execute function public.sync_channel_from_meta();
