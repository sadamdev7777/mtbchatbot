-- Web Push + personal quiet hours.
alter table public.members add column push_quiet_hours jsonb; -- {"start":"23:00","end":"07:00"} or null

-- Push every new notification (push-send applies prefs and quiet hours). No-op without the cron Vault secrets.
create or replace function public.on_notification_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_edge_function('push-send', jsonb_build_object('notification_id', new.id));
  return new;
end $$;
create trigger notifications_push after insert on public.notifications for each row execute function public.on_notification_insert();

-- VAPID public key for the browser (non-secret).
create or replace function public.rpc_push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select config ->> 'public_key' from public.integrations where company_id = public.auth_company_id() and key = 'web_push'
$$;
