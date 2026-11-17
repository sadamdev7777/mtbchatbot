-- Hosted Supabase rejects function calls without a JWT (verify_jwt). pg_cron calls now also send the
-- project's public anon key when the Vault secret 'edge_anon_key' exists; the function itself still
-- authenticates the call with x-internal-key.
--   select vault.create_secret('<anon key>', 'edge_anon_key');
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
  return rid;
end $$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;
