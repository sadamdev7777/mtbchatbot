-- Erase a customer on request (PDPA / Meta data deletion). Owner or admin only.
-- Deletes the contact, its chats, messages, notes and labels (FK cascade),
-- raw webhook payloads that carry the number, and blanks audit snapshots.
-- Payment verifications are kept for accounting with the contact link removed.
-- Returns the storage paths of chat media the caller must delete.

create or replace function public.rpc_erase_contact(p_contact uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare cid uuid := public.auth_company_id(); w text; paths text[]; n int;
begin
  if not public.auth_is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select wa_id into w from public.contacts where id = p_contact and company_id = cid;
  if w is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  select coalesce(array_agg(distinct m.media_path), '{}'), count(distinct c.id) into paths, n
  from public.conversations c left join public.messages m on m.conversation_id = c.id and m.media_path is not null
  where c.contact_id = p_contact;
  paths := array(select p from unnest(paths) p
    where p is not null and not exists (select 1 from public.payment_verifications v where v.receipt_media_path = p));

  delete from public.webhook_events where (company_id = cid or company_id is null) and payload::text like '%"' || w || '"%';
  update public.events set before = null, after = null where company_id = cid and entity = 'contacts' and entity_id = p_contact;
  delete from public.contacts where id = p_contact;
  insert into public.events (company_id, actor_member_id, action, entity, entity_id, after)
  values (cid, public.auth_member_id(), 'erase', 'contacts', p_contact, jsonb_build_object('conversations', n, 'media_files', cardinality(paths)));
  return paths;
end $$;

revoke execute on function public.rpc_erase_contact(uuid) from public, anon;
grant execute on function public.rpc_erase_contact(uuid) to authenticated;
