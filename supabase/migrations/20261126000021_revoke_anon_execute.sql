-- Nobody signed out should call database functions directly.
-- Every RPC the web app uses runs after sign-in, so anon needs none of them.
-- Keep exactly what signed-in users have today; only take EXECUTE away from anon (and PUBLIC, which anon inherits).
do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- Same rule for functions added later.
alter default privileges in schema public revoke execute on functions from public, anon;
