-- Manual rollback only. This file is deliberately outside supabase/migrations.
begin;

do $guard$
begin
  if exists (select 1 from public.reservation_sync_runs) then
    raise exception 'RESERVATION_SYNC_ROLLBACK_ABORT: sync run history exists';
  end if;

  if exists (
    select 1 from public.reservations where source_channel = 'sheets'
  ) then
    raise exception 'RESERVATION_SYNC_ROLLBACK_ABORT: sheets reservations exist';
  end if;
end
$guard$;

alter table public.reservations
  drop constraint reservations_source_check;

alter table public.reservations
  add constraint reservations_source_check
  check (source_channel in (
    'widget', 'typebot', 'whatsapp_ai', 'manager_manual', 'phone',
    'walk_in', 'api_partner', 'demo', 'legacy_unknown'
  ));

drop table public.reservation_sync_runs;

commit;
