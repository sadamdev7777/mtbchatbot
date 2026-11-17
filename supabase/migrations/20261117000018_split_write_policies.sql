-- Performance: "FOR ALL" write policies also applied to SELECT next to each table's read policy, so
-- Postgres evaluated two policies on every read. Split each into INSERT/UPDATE/DELETE with the same
-- conditions: who can do what is unchanged, reads now check only the read policy.
do $$
declare p record; chk text; role_list text;
begin
  for p in
    select tablename, policyname, qual, with_check, roles as r
    from pg_policies
    where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE'
      and exists (select 1 from pg_policies s where s.schemaname = 'public' and s.tablename = pg_policies.tablename and s.cmd = 'SELECT')
  loop
    chk := coalesce(p.with_check, p.qual);
    role_list := array_to_string(array(select quote_ident(x) from unnest(p.r) x), ', ');
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I for insert to %s with check (%s)', p.policyname || '_ins', p.tablename, role_list, chk);
    execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', p.policyname || '_upd', p.tablename, role_list, p.qual, chk);
    execute format('create policy %I on public.%I for delete to %s using (%s)', p.policyname || '_del', p.tablename, role_list, p.qual);
  end loop;
end $$;
