-- Rule 14: integration secrets live in Supabase Vault. Only the owner can set them; browsers only ever
-- see the last 4 characters. Edge Functions read them with the service role.

create or replace function public.set_integration_secret(p_key text, p_field text, p_value text)
returns text language plpgsql security definer set search_path = public, vault as $$
declare
  cid uuid := public.auth_company_id();
  integ public.integrations;
  ref jsonb;
  sid uuid;
  sname text;
  last4 text := right(coalesce(p_value, ''), 4);
begin
  if not public.auth_has_role(array['owner']) then
    raise exception 'only_owner_can_change_secrets' using errcode = '42501';
  end if;
  if coalesce(p_value, '') = '' then raise exception 'empty_secret'; end if;
  select * into integ from public.integrations where company_id = cid and key = p_key for update;
  if integ.id is null then raise exception 'integration_not_found'; end if;
  ref := integ.secret_refs -> p_field;
  sname := format('int:%s:%s:%s', cid, p_key, p_field);
  if ref is not null and (ref ->> 'id') is not null and exists (select 1 from vault.secrets where id = (ref ->> 'id')::uuid) then
    sid := (ref ->> 'id')::uuid;
    perform vault.update_secret(sid, p_value, sname, 'MTB Inbox integration secret');
  else
    sid := vault.create_secret(p_value, sname, 'MTB Inbox integration secret');
  end if;
  update public.integrations
     set secret_refs = secret_refs || jsonb_build_object(p_field, jsonb_build_object('id', sid, 'last4', last4, 'updated_at', now())),
         -- changing a secret requires a new passing test before the feature goes automatic
         status = case when status = 'connected' then 'not_connected' else status end
   where id = integ.id;
  return last4;
end $$;

create or replace function public.set_integration_config(p_key text, p_config jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.auth_company_id();
begin
  if not public.auth_has_role(array['owner']) then
    raise exception 'only_owner_can_change_integrations' using errcode = '42501';
  end if;
  update public.integrations
     set config = coalesce(p_config, '{}'::jsonb),
         status = case when status = 'connected' and config is distinct from coalesce(p_config, '{}'::jsonb) then 'not_connected' else status end
   where company_id = cid and key = p_key;
end $$;

-- Service role only: decrypted secret for an integration field.
create or replace function public.integration_secret(p_company uuid, p_key text, p_field text)
returns text language sql stable security definer set search_path = public, vault as $$
  select ds.decrypted_secret
  from public.integrations i
  join vault.decrypted_secrets ds on ds.id = (i.secret_refs -> p_field ->> 'id')::uuid
  where i.company_id = p_company and i.key = p_key
$$;

-- Service role only: record a connection test result. A feature goes automatic only after a passing test.
create or replace function public.record_integration_test(p_company uuid, p_key text, p_ok boolean, p_result jsonb)
returns void language sql security definer set search_path = public as $$
  update public.integrations
     set status = case when p_ok then 'connected' else 'error' end,
         last_test_at = now(),
         last_test_result = p_result
   where company_id = p_company and key = p_key
$$;

revoke execute on function public.integration_secret(uuid, text, text) from public, anon, authenticated;
grant execute on function public.integration_secret(uuid, text, text) to service_role;
revoke execute on function public.record_integration_test(uuid, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_integration_test(uuid, text, boolean, jsonb) to service_role;
