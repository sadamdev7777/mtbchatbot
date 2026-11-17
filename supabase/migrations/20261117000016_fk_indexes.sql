-- Performance: index every foreign key that has no covering index (joins, RLS lookups, cascades).
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  loop
    execute format('create index if not exists %I on %s (%s)', left(r.conname, 55) || '_idx', r.tbl, r.cols);
  end loop;
end $$;

-- Security lint: fixed search_path on trigger helpers.
alter function public.set_updated_at() set search_path = public;
alter function public.block_template_delete() set search_path = public;
