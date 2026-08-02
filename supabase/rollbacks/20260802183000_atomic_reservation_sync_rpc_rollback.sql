begin;

revoke all on function public.apply_reservation_sync_plan(text, uuid, jsonb)
  from public, anon, authenticated, service_role;

drop function public.apply_reservation_sync_plan(text, uuid, jsonb);

alter table public.reservation_sync_runs
  drop constraint reservation_sync_runs_client_request_key;

alter table public.reservation_sync_runs
  drop column request_id;

commit;
