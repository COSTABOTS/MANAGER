-- Disposable PostgreSQL only, after 20261031120000. All fixture writes roll back.
\set ON_ERROR_STOP on
begin;
\ir fixtures/weekly_rpc_environment_guard.sql

delete from public.booking_idempotency where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.reservations where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.booking_capacity_slots where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public.booking_day_controls where client_id in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');
delete from public."SETTINGS" where "CLIENTE_ID" in ('TEST-RPC-LEGACY','TEST-RPC-WEEKLY');

select public.replace_booking_service_hours('TEST-RPC-WEEKLY',
  (select jsonb_agg(jsonb_build_object(
    'weekday', d.weekday, 'service', s.service,
    'enabled', s.service='CENA' and d.weekday in (0,1)
      or s.service='ALMUERZO' and d.weekday=0,
    'start_time', case when s.service='CENA' and d.weekday in (0,1) then '18:00'
      when s.service='ALMUERZO' and d.weekday=0 then '17:00' else null end,
    'end_time', case when s.service='CENA' and d.weekday in (0,1) then '21:30'
      when s.service='ALMUERZO' and d.weekday=0 then '18:00' else null end
  ) order by d.weekday,s.service) from generate_series(0,6) d(weekday)
    cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)),
  public.get_booking_service_hours_snapshot('TEST-RPC-WEEKLY')->>'revision');
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values
  ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','true'),
  ('TEST-RPC-WEEKLY','SERVICES_ENABLED','ALMUERZO,CENA,BALINESA'),
  ('TEST-RPC-WEEKLY','BOOKING_INTERVAL','30');
insert into public.booking_capacity_slots(client_id,service,weekday,slot_time,capacity) values
  ('TEST-RPC-WEEKLY','CENA',1,'18:00',4),
  ('TEST-RPC-WEEKLY','CENA',1,'21:00',2),
  ('TEST-RPC-WEEKLY','CENA',0,'18:00',2),
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'17:30',2);

create schema weekly_walkin_margin_test;
create table weekly_walkin_margin_test.clock(value timestamptz not null);
insert into weekly_walkin_margin_test.clock values ('2026-11-02 16:29:59+00');
create or replace function public.hospitality_weekly_walkin_clock()
returns timestamptz language sql volatile security invoker
set search_path=pg_catalog,public
as $$ select value from weekly_walkin_margin_test.clock limit 1 $$;
create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz language sql volatile security invoker
set search_path=pg_catalog
as $$ select timestamptz '2026-10-24 10:00:00+00' $$;

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
    raise exception '17:29:59 was accepted or persisted';
  end if;
end $$;

update weekly_walkin_margin_test.clock set value='2026-11-02 16:30:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
update weekly_walkin_margin_test.clock set value='2026-11-02 17:10:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',2,'walk_in');
do $$
begin
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY'
    and service='CENA' and capacity_slot_time='18:00') <> 2
    or (select sum(pax) from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='CENA' and capacity_slot_time='18:00') <> 4
    or not exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
      and booking_date='2026-11-02' and booking_time='17:30' and capacity_slot_time='18:00') then
    raise exception 'early arrival, real time or first-slot capacity attribution failed';
  end if;
end $$;

do $$
declare rejected boolean := false; before_count integer;
begin
  select count(*) into before_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    perform public.create_hospitality_reservation('TEST-RPC-WEEKLY','full-early-slot',
      '{"booking_date":"2026-11-02","booking_time":"18:00","service":"CENA","pax":1}'::jsonb);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    rejected := true;
  end;
  if not rejected or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> before_count
    or exists(select 1 from public.booking_idempotency where client_id='TEST-RPC-WEEKLY'
      and idempotency_key='full-early-slot') then
    raise exception 'public creation ignored early walk-in or persisted rejected write';
  end if;
end $$;

update public.reservations set status='cancelled' where client_id='TEST-RPC-WEEKLY' and booking_time='17:30';
select public.create_hospitality_reservation('TEST-RPC-WEEKLY','after-early-cancel',
  '{"booking_date":"2026-11-02","booking_time":"18:00","service":"CENA","pax":2}'::jsonb);

update weekly_walkin_margin_test.clock set value='2026-11-02 20:30:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
update weekly_walkin_margin_test.clock set value='2026-11-02 20:59:59+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
do $$
begin
  if (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY'
    and service='CENA' and capacity_slot_time='21:00') <> 2
    or not exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
      and booking_time='21:59:59' and capacity_slot_time='21:00') then
    raise exception 'late arrivals did not consume the last service slot';
  end if;
end $$;

do $$
declare rejected integer := 0; before_count integer;
begin
  select count(*) into before_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    perform public.create_hospitality_reservation('TEST-RPC-WEEKLY','full-late-slot',
      '{"booking_date":"2026-11-02","booking_time":"21:00","service":"CENA","pax":1}'::jsonb);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    rejected := rejected + 1;
  end;
  update weekly_walkin_margin_test.clock set value='2026-11-02 20:45:00+00';
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'AVAILABILITY_EXHAUSTED' then raise; end if;
    rejected := rejected + 1;
  end;
  if rejected <> 2 or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> before_count
    or exists(select 1 from public.booking_idempotency where client_id='TEST-RPC-WEEKLY'
      and idempotency_key='full-late-slot') then
    raise exception 'full last slot overbooked or rejection persisted a write';
  end if;
end $$;

-- Release one seat and prove the exact 22:00 boundary still consumes the last service slot.
update public.reservations set status='cancelled' where client_id='TEST-RPC-WEEKLY'
  and booking_date='2026-11-02' and booking_time='21:59:59' and source_channel='walk_in';
update weekly_walkin_margin_test.clock set value='2026-11-02 21:00:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
do $$
begin
  if not exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
    and booking_date='2026-11-02' and booking_time='22:00' and capacity_slot_time='21:00') then
    raise exception 'exact 22:00 boundary did not consume the last service slot';
  end if;
end $$;
update weekly_walkin_margin_test.clock set value='2026-11-02 21:00:01+00';
do $$
declare rejected boolean := false; before_count integer;
begin
  select count(*) into before_count from public.reservations where client_id='TEST-RPC-WEEKLY';
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WALKIN_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := true;
  end;
  if not rejected or (select count(*) from public.reservations where client_id='TEST-RPC-WEEKLY') <> before_count then
    raise exception 'after 22:00 cutoff failed';
  end if;
end $$;

-- An open lunch wins over early dinner; an open dinner wins over late lunch.
update weekly_walkin_margin_test.clock set value='2026-11-01 16:50:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
update weekly_walkin_margin_test.clock set value='2026-11-01 17:00:00+00';
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-WEEKLY','2027-01-01','20:00','ALMUERZO',1,'walk_in');
do $$
begin
  if not exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
    and booking_time='17:50' and service='ALMUERZO' and capacity_slot_time='17:30')
    or not exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
      and booking_time='18:00' and service='CENA' and capacity_slot_time='18:00') then
    raise exception 'actually open service did not win margin overlap';
  end if;
end $$;

-- A closed day, disabled service, legacy tenant and Balinesa remain independent.
update weekly_walkin_margin_test.clock set value='2026-11-03 17:00:00+00';
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'WALKIN_OUTSIDE_WEEKLY_HOURS' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'closed Tuesday accepted walk-in'; end if;
end $$;
update public."SETTINGS" set "VALOR"='ALMUERZO,BALINESA'
  where "CLIENTE_ID"='TEST-RPC-WEEKLY' and "CLAVE"='SERVICES_ENABLED';
update weekly_walkin_margin_test.clock set value='2026-11-02 17:00:00+00';
do $$
declare rejected boolean := false;
begin
  begin
    insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
    values ('TEST-RPC-WEEKLY','2027-01-01','20:00','CENA',1,'walk_in');
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'SERVICE_NOT_ENABLED' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'disabled dinner accepted walk-in'; end if;
end $$;
insert into public.reservations(client_id,booking_date,booking_time,service,pax,source_channel)
values ('TEST-RPC-LEGACY','2026-11-02','18:10','CENA',1,'walk_in'),
       ('TEST-RPC-WEEKLY','2026-11-02','18:10','BALINESA',1,'walk_in');
do $$
begin
  if exists(select 1 from public.reservations where client_id='TEST-RPC-LEGACY' and capacity_slot_time is not null)
    or exists(select 1 from public.reservations where client_id='TEST-RPC-WEEKLY'
      and service='BALINESA' and capacity_slot_time is not null) then
    raise exception 'legacy or Balinesa changed';
  end if;
end $$;
rollback;
