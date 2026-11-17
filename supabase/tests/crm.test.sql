begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- duplicates + merge
insert into public.contacts (id, company_id, wa_id, name, email, opt_in) values
 ('61000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','60177770001','Siti Aminah','siti@x.com', true),
 ('61000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','60177770002','siti aminah','SITI@x.com', false);
insert into public.conversations (id, company_id, channel_id, contact_id) values
 ('71000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002');
insert into public.messages (company_id, conversation_id, direction, sender_type, body, status)
values ('00000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','in','customer','hello','received');

select is((select count(*) from public.contact_duplicates where merge_id = '61000000-0000-0000-0000-000000000002')::int, 1, 'same name and email, different numbers is a duplicate');

insert into public.mfa_codes (company_id, user_id, session_id, code_hash, expires_at, verified_at)
values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000000','x', now(), now());
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"99999999-0000-0000-0000-000000000000"}', true);
select lives_ok($$ select public.rpc_merge_contacts('61000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002') $$, 'owner merges contacts');
select set_config('role', 'postgres', true);
select is((select contact_id from public.conversations where id = '71000000-0000-0000-0000-000000000002'), '61000000-0000-0000-0000-000000000001'::uuid, 'conversation moved to the kept contact');
select is((select merged_into_id from public.contacts where id = '61000000-0000-0000-0000-000000000002'), '61000000-0000-0000-0000-000000000001'::uuid, 'merged contact points to the kept one');

-- segments respect opt-in / opt-out
update public.contacts set opted_out_at = now() where id = '60000000-0000-0000-0000-000000000002';
select ok(not exists (select 1 from public.segment_contacts('00000000-0000-0000-0000-000000000001', '{}') where contact_id = '60000000-0000-0000-0000-000000000002'), 'opted-out contacts are never in a segment');
select ok(exists (select 1 from public.segment_contacts('00000000-0000-0000-0000-000000000001', '{"stages":["lead"]}') where contact_id = '60000000-0000-0000-0000-000000000001'), 'stage filter keeps matching contacts');
select ok(not exists (select 1 from public.segment_contacts('00000000-0000-0000-0000-000000000001', '{"stages":["deposit"]}') where contact_id = '60000000-0000-0000-0000-000000000001'), 'stage filter drops others');

-- round-robin skips people on leave and offline staff
update public.members set last_seen_at = now(), on_leave_until = null where id in ('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004');
update public.members set on_leave_until = current_date where id = '20000000-0000-0000-0000-000000000004';
select is(public.pick_round_robin('30000000-0000-0000-0000-000000000001', null), '20000000-0000-0000-0000-000000000003'::uuid, 'round-robin skips staff on leave');
update public.members set on_leave_until = null where id = '20000000-0000-0000-0000-000000000004';
update public.conversations set holder_type = 'staff', holder_member_id = '20000000-0000-0000-0000-000000000003' where id = '70000000-0000-0000-0000-000000000003';
select is(public.pick_round_robin('30000000-0000-0000-0000-000000000001', null), '20000000-0000-0000-0000-000000000004'::uuid, 'round-robin picks the online member with fewer open chats');

select * from finish();
rollback;
