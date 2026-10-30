-- Run only after the isolated Phase 1, service-hours, CAS and walk-in-capacity migrations.
\set ON_ERROR_STOP on
begin;
\ir fixtures/weekly_rpc_environment_guard.sql

delete from public.booking_idempotency where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.reservations where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.booking_capacity_slots where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.booking_day_controls where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public."SETTINGS" where "CLIENTE_ID" in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');

select public.replace_booking_service_hours(
  'TEST-RPC-WEEKLY',
  (select jsonb_agg(jsonb_build_object(
    'weekday',d.weekday,'service',s.service,
    'enabled',d.weekday=0 and s.service in ('ALMUERZO','CENA'),
    'start_time',case when d.weekday=0 and s.service='ALMUERZO' then '18:00'
                      when d.weekday=0 and s.service='CENA' then '18:00' else null end,
    'end_time',case when d.weekday=0 and s.service='ALMUERZO' then '19:00'
                    when d.weekday=0 and s.service='CENA' then '23:00' else null end
  ) order by d.weekday,s.service) from generate_series(0,6) d(weekday)
    cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)),
  public.get_booking_service_hours_snapshot('TEST-RPC-WEEKLY')->>'revision'
);
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values
  ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','true'),
  ('TEST-RPC-WEEKLY','SERVICES_ENABLED','ALMUERZO,CENA,BALINESA'),
  ('TEST-RPC-WEEKLY','BOOKING_INTERVAL','30');
insert into public.booking_capacity_slots(client_id,service,weekday,slot_time,capacity) values
  ('TEST-RPC-WEEKLY','CENA',0,'18:00',4),
  ('TEST-RPC-WEEKLY','CENA',0,'18:30',4),
  ('TEST-RPC-WEEKLY','CENA',0,'19:00',4),
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'18:00',2);

-- Contradictory mode rows must never be interpreted as either legacy or weekly.
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR")
values ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','false');
do $$
declare rejected integer := 0;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2026-11-01','18:00','CENA',1,'manager_manual');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WEEKLY_HOURS_CONFIG_INVALID' then raise; end if;
    rejected := rejected + 1;
  end;
  begin
    perform public.create_hospitality_reservation('TEST-RPC-WEEKLY','ambiguous-weekly-flag',
      '{"booking_date":"2026-11-01","booking_time":"18:00","service":"CENA","pax":1}'::jsonb);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WEEKLY_HOURS_CONFIG_INVALID' then raise; end if;
    rejected := rejected + 1;
  end;
  if rejected <> 2 or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY')
    or exists(select 1 from public.booking_idempotency where client_id='TEST-RPC-WEEKLY'
      and idempotency_key='ambiguous-weekly-flag') then
    raise exception 'contradictory weekly flags allowed a persistent write';
  end if;
end $$;
delete from public."SETTINGS" where "CLIENTE_ID"='TEST-RPC-WEEKLY'
  and "CLAVE"='WEEKLY_HOURS_ENABLED' and "VALOR"='false';

create schema weekly_walkin_test;
create table weekly_walkin_test.clock(value timestamptz not null);
insert into weekly_walkin_test.clock values ('2026-11-01 16:50:00+00');
create or replace function public.hospitality_weekly_walkin_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog, public
as $$ select value from weekly_walkin_test.clock limit 1 $$;

do $$
declare rejected integer := 0;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2026-11-01','17:50','CENA',1,'manager_manual');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RESERVATION_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := rejected + 1;
  end;
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2026-11-02','18:00','CENA',1,'manager_manual');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'RESERVATION_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := rejected + 1;
  end;
  if rejected <> 2 or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY') then
    raise exception 'manual reservation escaped the selected day or service hours';
  end if;
end $$;

-- Neither a forged payload nor an early arrival may invent an open service.
update weekly_walkin_test.clock set value='2026-11-01 00:29:00+00';
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WALKIN_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := true;
  end;
  if not rejected or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY') then
    raise exception '01:29 walk-in created a reservation';
  end if;
end $$;
update weekly_walkin_test.clock set value='2026-11-01 16:50:00+00';
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WALKIN_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := true;
  end;
  if not rejected or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY') then
    raise exception '17:50 walk-in created a reservation before dinner';
  end if;
end $$;
update weekly_walkin_test.clock set value='2026-11-01 17:00:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
update weekly_walkin_test.clock set value='2026-11-01 17:10:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
update weekly_walkin_test.clock set value='2026-11-01 17:20:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
update weekly_walkin_test.clock set value='2026-11-01 17:10:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','ALMUERZO',1,'walk_in');
do $$
begin
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='CENA' and capacity_slot_time='18:00') <> 3
     or (select sum(pax) from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='CENA' and capacity_slot_time='18:00') <> 4
     or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='CENA' and booking_time='18:00' and capacity_slot_time='18:00') <> 1
     or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='ALMUERZO' and capacity_slot_time='18:00') <> 1 then
    raise exception 'arrival time, slot attribution or service separation failed';
  end if;
end $$;

create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select timestamptz '2026-10-24 10:00:00+00' $$;
do $$
declare failed boolean := false; previous_count integer;
begin
  select count(*) into previous_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    perform public.create_hospitality_reservation('TEST-RPC-WEEKLY','full-dinner',
      '{"booking_date":"2026-11-01","booking_time":"18:00","service":"CENA","pax":1}'::jsonb);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    failed := true;
  end;
  if not failed or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> previous_count
    or exists(select 1 from public.booking_idempotency where client_id='TEST-RPC-WEEKLY' and idempotency_key='full-dinner') then
    raise exception 'full dinner allowed public overbooking or persisted a rejected write';
  end if;
  failed := false;
  update weekly_walkin_test.clock set value='2026-11-01 17:25:00+00';
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2026-11-01','18:25','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    failed := true;
  end;
  if not failed or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> previous_count then
    raise exception 'full dinner allowed an additional walk-in';
  end if;
  failed := false;
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2026-11-01','18:15','CENA',1,'manager_manual');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    failed := true;
  end;
  if not failed or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> previous_count then
    raise exception 'full dinner allowed an additional manual reservation';
  end if;
end $$;

update public.reservations set status='cancelled' where client_id='TEST-RPC-WEEKLY'
  and service='CENA' and booking_time='18:00';
select public.create_hospitality_reservation('TEST-RPC-WEEKLY','after-cancel',
  '{"booking_date":"2026-11-01","booking_time":"18:00","service":"CENA","pax":2}'::jsonb);
do $$
begin
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY' and service='CENA'
    and coalesce(capacity_slot_time,booking_time)='18:00' and status<>'cancelled') <> 3 then
    raise exception 'cancellation did not release exactly two places';
  end if;
end $$;

do $$
declare failed boolean := false; previous_count integer;
begin
  update weekly_walkin_test.clock set value='2026-11-01 17:25:00+00';
  select count(*) into previous_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    failed := true;
  end;
  if not failed or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> previous_count then
    raise exception 'walk-in ignored the public booking in the same capacity slot';
  end if;
end $$;

update weekly_walkin_test.clock set value='2026-11-01 17:40:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2026-11-01','18:45','CENA',1,'manager_manual');
do $$
begin
  if (select capacity_slot_time from public.reservations where client_id='TEST-RPC-WEEKLY'
    and booking_time='18:40' and source_channel='walk_in') <> time '18:30' then
    raise exception '18:40 did not map to the 18:30 slot';
  end if;
  if (select capacity_slot_time from public.reservations where client_id='TEST-RPC-WEEKLY'
    and booking_time='18:45' and source_channel='manager_manual') <> time '18:30' then
    raise exception 'manual reservation did not consume the matching service slot';
  end if;
end $$;

update public."SETTINGS" set "VALOR"='60' where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='BOOKING_INTERVAL';
update weekly_walkin_test.clock set value='2026-11-01 18:20:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
do $$
begin
  if (select capacity_slot_time from public.reservations where client_id='TEST-RPC-WEEKLY'
    and booking_time='19:20' and source_channel='walk_in') <> time '19:00' then
    raise exception '60-minute interval did not map 19:20 to 19:00';
  end if;
end $$;

insert into public.booking_day_controls(client_id,booking_date,service,status,fully_booked)
values ('TEST-RPC-WEEKLY','2026-11-01','CENA','closed',true);
do $$
declare failed boolean := false; previous_count integer;
begin
  select count(*) into previous_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    failed := true;
  end;
  if not failed or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> previous_count then
    raise exception 'Fully Booked did not reject walk-in without writes';
  end if;
end $$;

-- Missing weekly flag and Balinese still use their existing write path.
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-LEGACY','2026-11-01','18:10','CENA',1,'walk_in'),
       ('TEST-RPC-WEEKLY','2026-11-01','18:10','BALINESA',1,'walk_in');
do $$
begin
  if exists(select 1 from public.reservations where client_id='TEST-RPC-LEGACY'
    and capacity_slot_time is not null)
    or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='BALINESA' and capacity_slot_time is not null) then
    raise exception 'legacy or Balinese behavior changed';
  end if;
end $$;
rollback;
