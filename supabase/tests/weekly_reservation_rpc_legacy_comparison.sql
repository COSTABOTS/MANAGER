-- Run unchanged before and after the new RPC migration in PostgreSQL 16 only.
-- Every assertion is transactional and rolls back.
\set ON_ERROR_STOP on
begin;
\ir fixtures/weekly_rpc_environment_guard.sql
delete from public.booking_idempotency where client_id in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
delete from public.reservations where client_id in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
delete from public.booking_capacity_slots where client_id in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
delete from public.booking_day_controls where client_id in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
delete from public.booking_blocks where client_id in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
delete from public."SETTINGS" where "CLIENTE_ID" in ('TEST-RPC-LEGACY','TEST-RPC-OTHER');
create schema weekly_test;

create function weekly_test.expect_rejection(
  p_client text, p_key text, p_payload jsonb, p_expected text
) returns void language plpgsql as $$
declare
  before_reservations integer; before_keys integer;
  after_reservations integer; after_keys integer;
  rejected boolean := false; actual_message text;
begin
  select count(*) into before_reservations from public.reservations where client_id=p_client;
  select count(*) into before_keys from public.booking_idempotency where client_id=p_client;
  begin
    perform public.create_hospitality_reservation(p_client,p_key,p_payload);
  exception when sqlstate 'P0001' then
    get stacked diagnostics actual_message = message_text;
    if actual_message <> p_expected then
      raise exception 'expected %, got %', p_expected, actual_message;
    end if;
    rejected := true;
  end;
  if not rejected then raise exception 'expected rejection % for %', p_expected, p_key; end if;
  select count(*) into after_reservations from public.reservations where client_id=p_client;
  select count(*) into after_keys from public.booking_idempotency where client_id=p_client;
  if (before_reservations,before_keys) is distinct from (after_reservations,after_keys) then
    raise exception 'rejection % persisted a reservation or idempotency row', p_key;
  end if;
end $$;

insert into public.booking_capacity_slots(client_id,service,weekday,slot_time,capacity) values
  ('TEST-RPC-LEGACY','ALMUERZO',null,'12:00',2),
  ('TEST-RPC-LEGACY','ALMUERZO',null,'13:00',2),
  ('TEST-RPC-LEGACY','ALMUERZO',0,'14:00',2),
  ('TEST-RPC-LEGACY','ALMUERZO',null,'15:00',2),
  ('TEST-RPC-LEGACY','ALMUERZO',null,'16:00',2),
  ('TEST-RPC-OTHER','ALMUERZO',null,'12:00',2);
insert into public.booking_day_controls(client_id,service,booking_date,fully_booked)
values ('TEST-RPC-LEGACY','ALMUERZO','2026-10-26',true);
insert into public.booking_blocks(client_id,service,booking_date,starts_at,ends_at,capacity_reduction)
values ('TEST-RPC-LEGACY','ALMUERZO','2026-10-27','16:00','17:00',2);
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values
  ('TEST-RPC-LEGACY','BOOKINGS_ENABLED','false'),
  ('TEST-RPC-LEGACY','SERVICES_ENABLED','CENA'),
  ('TEST-RPC-OTHER','WEEKLY_HOURS_ENABLED','false');

do $$
declare payload jsonb; first_result jsonb; replay jsonb; other_result jsonb;
begin
  payload := '{"booking_date":"2026-10-25","booking_time":"12:00","service":"ALMUERZO","pax":2}'::jsonb;
  first_result := public.create_hospitality_reservation('TEST-RPC-LEGACY','legacy-one',payload);
  replay := public.create_hospitality_reservation('TEST-RPC-LEGACY','legacy-one',payload);
  if first_result->>'idempotent_replay' <> 'false'
     or replay->>'idempotent_replay' <> 'true'
     or replay->>'reservation_id' <> first_result->>'reservation_id' then
    raise exception 'legacy idempotency changed';
  end if;
  if (select count(*) from public.reservations where client_id='TEST-RPC-LEGACY') <> 1
     or (select count(*) from public.booking_idempotency where client_id='TEST-RPC-LEGACY') <> 1 then
    raise exception 'legacy creation or idempotency wrote unexpected rows';
  end if;

  perform weekly_test.expect_rejection('TEST-RPC-LEGACY','legacy-full',payload,'AVAILABILITY_EXHAUSTED');
  -- Preserve the original ISODOW=7 behavior for a Sunday-specific weekday=0 capacity.
  perform weekly_test.expect_rejection('TEST-RPC-LEGACY','legacy-sunday-specific',
    payload || '{"booking_time":"14:00"}'::jsonb,'AVAILABILITY_EXHAUSTED');
  perform weekly_test.expect_rejection('TEST-RPC-LEGACY','legacy-fully-booked',
    payload || '{"booking_date":"2026-10-26","booking_time":"15:00"}'::jsonb,'AVAILABILITY_EXHAUSTED');
  perform weekly_test.expect_rejection('TEST-RPC-LEGACY','legacy-block',
    payload || '{"booking_date":"2026-10-27","booking_time":"16:00"}'::jsonb,'AVAILABILITY_EXHAUSTED');

  other_result := public.create_hospitality_reservation('TEST-RPC-OTHER','legacy-flag-false',payload);
  if other_result->>'idempotent_replay' <> 'false' then
    raise exception 'explicit false did not retain legacy creation';
  end if;
end $$;

-- An unavailable weekly table cannot affect an absent/false tenant flag.
alter table public.booking_service_hours rename to booking_service_hours_unavailable;
select public.create_hospitality_reservation('TEST-RPC-LEGACY','legacy-no-weekly-read',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb);
alter table public.booking_service_hours_unavailable rename to booking_service_hours;

select 'LEGACY_COMPARISON_PASS' as result;
rollback;
