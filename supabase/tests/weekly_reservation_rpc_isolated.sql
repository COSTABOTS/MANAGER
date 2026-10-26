-- Full restaurant RPC assertions for a disposable PostgreSQL 16 database only.
\set ON_ERROR_STOP on
begin;
\ir fixtures/weekly_rpc_environment_guard.sql

-- Helper functions are callable by the definer RPC, not directly by API roles.
do $$
begin
  if has_function_privilege('anon', 'public.hospitality_weekly_reservation_clock()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.hospitality_weekly_reservation_clock()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.hospitality_weekly_reservation_clock()', 'EXECUTE')
     or has_function_privilege('anon', 'public.hospitality_weekly_reservation_time_eligible(date,time,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.hospitality_weekly_reservation_time_eligible(date,time,timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.hospitality_weekly_reservation_time_eligible(date,time,timestamptz)', 'EXECUTE') then
    raise exception 'weekly clock or time helper leaked EXECUTE permission';
  end if;
end $$;

-- Deterministic instant tests: exact seconds/milliseconds and both DST transitions.
do $$
begin
  if public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 10:30:01+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 10:30:00+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 10:29:59+00')
     or public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 10:30:00.001+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 10:29:59.999+00')
     or public.hospitality_weekly_reservation_time_eligible('2026-11-01','12:00','2026-11-01 11:00:01+00') then
    raise exception '30-minute instant boundary failed';
  end if;
  if public.hospitality_weekly_reservation_time_eligible('2026-03-29','02:30','2026-03-28 20:00+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-03-29','01:30','2026-03-29 00:00+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-03-29','03:30','2026-03-29 01:00+00')
     or public.hospitality_weekly_reservation_time_eligible('2026-10-25','02:30','2026-10-24 20:00+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-10-25','01:30','2026-10-24 23:00+00')
     or not public.hospitality_weekly_reservation_time_eligible('2026-10-25','03:30','2026-10-25 02:00+00') then
    raise exception 'Europe/Madrid DST gap or fold handling failed';
  end if;
end $$;

-- Local-only clock seam; this replacement rolls back with the test transaction.
create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-24 10:00:00+00' $$;
delete from public.booking_idempotency where client_id in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
delete from public.reservations where client_id in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
delete from public.booking_capacity_slots where client_id in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
delete from public.booking_day_controls where client_id in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
delete from public.booking_blocks where client_id in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
delete from public."SETTINGS" where "CLIENTE_ID" in ('TEST-RPC-WEEKLY','TEST-RPC-OTHER');
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

select public.replace_booking_service_hours(
  'TEST-RPC-WEEKLY',
  (select jsonb_agg(jsonb_build_object(
    'weekday',d.weekday,'service',s.service,
    'enabled',d.weekday=0 and s.service='ALMUERZO',
    'start_time',case when d.weekday=0 and s.service='ALMUERZO' then '11:00' else null end,
    'end_time',case when d.weekday=0 and s.service='ALMUERZO' then '18:00' else null end
  ) order by d.weekday,s.service)
   from generate_series(0,6) d(weekday)
   cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)),
  public.get_booking_service_hours_snapshot('TEST-RPC-WEEKLY')->>'revision'
);
select public.replace_booking_service_hours(
  'TEST-RPC-OTHER',
  (select jsonb_agg(jsonb_build_object(
    'weekday',d.weekday,'service',s.service,
    'enabled',(d.weekday=0 and s.service in ('ALMUERZO','CENA'))
              or (d.weekday=1 and s.service='CENA'),
    'start_time',case when d.weekday=0 and s.service='ALMUERZO' then '11:00'
                      when d.weekday in (0,1) and s.service='CENA' then '19:00' else null end,
    'end_time',case when d.weekday=0 and s.service='ALMUERZO' then '18:00'
                    when d.weekday in (0,1) and s.service='CENA' then '23:00' else null end
  ) order by d.weekday,s.service)
   from generate_series(0,6) d(weekday)
   cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)),
  public.get_booking_service_hours_snapshot('TEST-RPC-OTHER')->>'revision'
);

insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values
  ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','true'),
  ('TEST-RPC-WEEKLY','SERVICES_ENABLED','ALMUERZO'),
  ('TEST-RPC-WEEKLY','BOOKINGS_ENABLED','true'),
  ('TEST-RPC-OTHER','WEEKLY_HOURS_ENABLED','true');
insert into public.booking_capacity_slots(client_id,service,weekday,slot_time,capacity) values
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'11:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'12:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'13:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'14:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'15:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'17:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'18:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',null,'10:59',2),
  ('TEST-RPC-WEEKLY','CENA',null,'20:00',2),
  ('TEST-RPC-OTHER','ALMUERZO',null,'13:00',2),
  ('TEST-RPC-OTHER','CENA',null,'19:00',2),
  ('TEST-RPC-OTHER','CENA',null,'20:00',2),
  ('TEST-RPC-OTHER','CENA',1,'19:00',2);

do $$
declare payload jsonb; created jsonb; replay jsonb;
begin
  payload := '{"booking_date":"2026-10-25","booking_time":"11:00","service":"ALMUERZO","pax":2}'::jsonb;
  created := public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-start',payload);
  replay := public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-start',payload);
  if created->>'idempotent_replay' <> 'false' or replay->>'idempotent_replay' <> 'true'
     or created->>'reservation_id' <> replay->>'reservation_id' then
    raise exception 'weekly idempotency changed';
  end if;
  perform weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-exhausted',payload,'AVAILABILITY_EXHAUSTED');
  perform weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-before',
    payload || '{"booking_time":"10:59"}'::jsonb,'RESERVATION_OUTSIDE_WEEKLY_HOURS');
  perform weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-end',
    payload || '{"booking_time":"18:00"}'::jsonb,'RESERVATION_OUTSIDE_WEEKLY_HOURS');
  perform weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-closed-service',
    payload || '{"booking_time":"20:00","service":"CENA"}'::jsonb,'SERVICE_NOT_ENABLED');
  perform weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-unknown-service',
    payload || '{"service":"SNACK"}'::jsonb,'SERVICE_NOT_ENABLED');
  if (public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-sunday-zero',
    payload || '{"booking_time":"12:00"}'::jsonb)->>'idempotent_replay') <> 'false' then
    raise exception 'Sunday weekday=0 capacity did not create';
  end if;
  if (public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-general',
    payload || '{"booking_time":"13:00"}'::jsonb)->>'idempotent_replay') <> 'false' then
    raise exception 'weekday=NULL capacity did not create';
  end if;
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> 3 then
    raise exception 'weekly creation wrote unexpected row count';
  end if;
end $$;

update public."SETTINGS" set "VALOR"='ALMUERZO,CENA'
where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='SERVICES_ENABLED';
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-closed-rule',
  '{"booking_date":"2026-10-25","booking_time":"20:00","service":"CENA","pax":1}'::jsonb,
  'RESERVATION_OUTSIDE_WEEKLY_HOURS');
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-closed-day',
  '{"booking_date":"2026-10-26","booking_time":"11:00","service":"ALMUERZO","pax":1}'::jsonb,
  'RESERVATION_OUTSIDE_WEEKLY_HOURS');
update public."SETTINGS" set "VALOR"='ALMUERZO'
where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='SERVICES_ENABLED';

-- Fully Booked and blocks remain independent and prevail over open hours.
insert into public.booking_day_controls(client_id,service,booking_date,fully_booked)
values ('TEST-RPC-WEEKLY','ALMUERZO','2026-10-25',true);
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-fully-booked',
  '{"booking_date":"2026-10-25","booking_time":"14:00","service":"ALMUERZO","pax":1}'::jsonb,
  'AVAILABILITY_EXHAUSTED');
delete from public.booking_day_controls where client_id='TEST-RPC-WEEKLY';
insert into public.booking_blocks(client_id,service,booking_date,starts_at,ends_at,capacity_reduction)
values ('TEST-RPC-WEEKLY','ALMUERZO','2026-10-25','15:00','16:00',2);
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-block',
  '{"booking_date":"2026-10-25","booking_time":"15:00","service":"ALMUERZO","pax":1}'::jsonb,
  'AVAILABILITY_EXHAUSTED');

-- Missing/empty SERVICES_ENABLED defaults to CENA, even if ALMUERZO is open.
select weekly_test.expect_rejection('TEST-RPC-OTHER','other-lunch',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb,
  'SERVICE_NOT_ENABLED');
select public.create_hospitality_reservation('TEST-RPC-OTHER','other-dinner',
  '{"booking_date":"2026-10-25","booking_time":"19:00","service":"CENA","pax":1}'::jsonb);
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values ('TEST-RPC-OTHER','SERVICES_ENABLED','');
select public.create_hospitality_reservation('TEST-RPC-OTHER','other-empty-services',
  '{"booking_date":"2026-10-25","booking_time":"20:00","service":"CENA","pax":1}'::jsonb);
select weekly_test.expect_rejection('TEST-RPC-OTHER','other-lunch-empty',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb,
  'SERVICE_NOT_ENABLED');

-- A globally offered service still needs its own open day and capacity.
-- BALINESA in SERVICES_ENABLED does not create a weekly restaurant rule.
update public."SETTINGS" set "VALOR"='ALMUERZO,CENA,BALINESA'
where "CLIENTE_ID"='TEST-RPC-OTHER' and "CLAVE"='SERVICES_ENABLED';
select public.create_hospitality_reservation('TEST-RPC-OTHER','other-sunday-lunch',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb);
select weekly_test.expect_rejection('TEST-RPC-OTHER','other-monday-lunch',
  '{"booking_date":"2026-10-26","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb,
  'RESERVATION_OUTSIDE_WEEKLY_HOURS');
select public.create_hospitality_reservation('TEST-RPC-OTHER','other-monday-dinner',
  '{"booking_date":"2026-10-26","booking_time":"19:00","service":"CENA","pax":1}'::jsonb);
update public."SETTINGS" set "VALOR"='CENA,BALINESA'
where "CLIENTE_ID"='TEST-RPC-OTHER' and "CLAVE"='SERVICES_ENABLED';
select weekly_test.expect_rejection('TEST-RPC-OTHER','other-globally-disabled-lunch',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb,
  'SERVICE_NOT_ENABLED');
update public."SETTINGS" set "VALOR"='BALINESA'
where "CLIENTE_ID"='TEST-RPC-OTHER' and "CLAVE"='SERVICES_ENABLED';
select weekly_test.expect_rejection('TEST-RPC-OTHER','other-balinese-only-dinner',
  '{"booking_date":"2026-10-25","booking_time":"19:00","service":"CENA","pax":1}'::jsonb,
  'SERVICE_NOT_ENABLED');

update public."SETTINGS" set "VALOR"='false'
where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='BOOKINGS_ENABLED';
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-disabled',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'BOOKINGS_DISABLED');
update public."SETTINGS" set "VALOR"='true'
where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='BOOKINGS_ENABLED';

update public.booking_service_hours set start_time='11:00:30'
where client_id='TEST-RPC-WEEKLY' and weekday=0 and service='ALMUERZO';
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-seconds-invalid',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_INVALID');
update public.booking_service_hours set start_time='11:00'
where client_id='TEST-RPC-WEEKLY' and weekday=0 and service='ALMUERZO';

insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR")
values ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','false');
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-flag-conflict',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_INVALID');
delete from public."SETTINGS"
where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='WEEKLY_HOURS_ENABLED' and "VALOR"='false';

-- Incomplete configuration and read failure must not write idempotency rows.
delete from public.booking_service_hours
where client_id='TEST-RPC-WEEKLY' and weekday=6 and service='CENA';
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-incomplete',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_INVALID');
insert into public.booking_service_hours(client_id,weekday,service,enabled)
values ('TEST-RPC-WEEKLY',6,'CENA',false);
alter table public.booking_service_hours rename to booking_service_hours_unavailable;
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-read-error',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_READ_FAILED');
alter table public.booking_service_hours_unavailable rename to booking_service_hours;

-- Direct Manager writes and the independent Balinese RPC are unaffected.
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2026-10-25','20:00','CENA',1,'manager_manual');
insert into public.reservable_resources(client_id,resource_type,label,capacity)
values ('TEST-RPC-WEEKLY','balinese','ISOLATED-BALINESE',4);
select public.create_hospitality_balinese_reservation(
  'TEST-RPC-WEEKLY','balinese-independent',
  '{"booking_date":"2026-10-25","booking_time":"12:00","service":"BALINESA","pax":4}'::jsonb
);

do $$
begin
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY' and source_channel='manager_manual') <> 1
     or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY' and service='BALINESA') <> 1 then
    raise exception 'Manager or Balinese isolation failed';
  end if;
end $$;

-- A failed SETTINGS read currently fails closed for both weekly and legacy.
-- This proves the availability tradeoff; neither rejection may persist writes.
alter table public."SETTINGS" rename to "SETTINGS_UNAVAILABLE";
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-settings-read-failed',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_READ_FAILED');
select weekly_test.expect_rejection('TEST-RPC-LEGACY','legacy-settings-read-failed',
  '{"booking_date":"2026-10-25","booking_time":"13:00","service":"ALMUERZO","pax":1}'::jsonb,
  'WEEKLY_HOURS_CONFIG_READ_FAILED');
alter table public."SETTINGS_UNAVAILABLE" rename to "SETTINGS";

-- Full RPC path: reject +29:59 before writing, accept +30:00 and +30:01.
create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-25 15:30:01+00' $$;
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-time-29m59s',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb,
  'RESERVATION_TIME_PASSED');

create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-25 15:30:00+00' $$;
select public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-time-exact',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb);

create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-25 15:29:59+00' $$;
select public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-time-plus-one',
  '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb);

create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-25 16:00:00+00' $$;
select weekly_test.expect_rejection('TEST-RPC-WEEKLY','weekly-time-past',
  '{"booking_date":"2026-10-25","booking_time":"14:00","service":"ALMUERZO","pax":1}'::jsonb,
  'RESERVATION_TIME_PASSED');
do $$
declare replay jsonb; original_id uuid;
begin
  select reservation_id into original_id from public.booking_idempotency
  where client_id='TEST-RPC-WEEKLY' and idempotency_key='weekly-time-exact';
  replay := public.create_hospitality_reservation('TEST-RPC-WEEKLY','weekly-time-exact',
    '{"booking_date":"2026-10-25","booking_time":"17:00","service":"ALMUERZO","pax":1}'::jsonb);
  if original_id is null or replay->>'idempotent_replay' <> 'true'
     or (replay->>'reservation_id')::uuid <> original_id then
    raise exception 'valid idempotent replay changed after the time limit';
  end if;
end $$;

select 'WEEKLY_RPC_PASS' as result;
rollback;
