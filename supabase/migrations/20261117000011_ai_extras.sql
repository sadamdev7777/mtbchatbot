-- Itinerary questions can be sent to another staff member (notification + their question list).
create or replace function public.rpc_assign_itinerary_questions(p_itinerary uuid, p_member uuid, p_question_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare it public.itineraries; n int; mname text;
begin
  select * into it from public.itineraries where id = p_itinerary;
  if it.id is null or it.company_id <> public.auth_company_id() or not public.auth_is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.itinerary_questions set assigned_member_id = p_member
   where itinerary_id = p_itinerary and answer is null and (p_question_ids is null or id = any(p_question_ids));
  get diagnostics n = row_count;
  select display_name into mname from public.members where id = public.auth_member_id();
  perform public.notify_member(p_member, 'itinerary_questions', mname || ' sent you ' || n || ' itinerary question(s)', it.file_name, '/questions');
  return n;
end $$;
