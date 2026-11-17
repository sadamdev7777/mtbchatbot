-- Bank inbox polling timestamp (kept out of the audited config column).
alter table public.integrations add column last_synced_at timestamptz;

create or replace function public.rpc_bank_inbox_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', status, 'email', config ->> 'email', 'last_synced_at', last_synced_at,
                            'trusted_senders', config ->> 'trusted_senders')
  from public.integrations
  where company_id = public.auth_company_id() and key = 'bank_email' and public.auth_has_role(array['owner','admin','accounts'])
$$;
