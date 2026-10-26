-- Persistent fixtures ONLY inside the disposable weekly_rpc_test database.
\set ON_ERROR_STOP on
\ir fixtures/weekly_rpc_environment_guard.sql
delete from public.booking_idempotency where client_id='TEST-RPC-WEEKLY';
delete from public.reservations where client_id='TEST-RPC-WEEKLY';
delete from public.booking_capacity_slots where client_id='TEST-RPC-WEEKLY';
delete from public.booking_day_controls where client_id='TEST-RPC-WEEKLY';
delete from public.booking_blocks where client_id='TEST-RPC-WEEKLY';
delete from public."SETTINGS" where "CLIENTE_ID"='TEST-RPC-WEEKLY';
select public.replace_booking_service_hours(
  'TEST-RPC-WEEKLY',
  (select jsonb_agg(jsonb_build_object(
    'weekday',d.weekday,'service',s.service,
    'enabled',d.weekday=0 and s.service='ALMUERZO',
    'start_time',case when d.weekday=0 and s.service='ALMUERZO' then '11:00' else null end,
    'end_time',case when d.weekday=0 and s.service='ALMUERZO' then '18:00' else null end
  ) order by d.weekday,s.service)
   from generate_series(0,6) d(weekday)
   cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service))
);
insert into public."SETTINGS"("CLIENTE_ID","CLAVE","VALOR") values
  ('TEST-RPC-WEEKLY','WEEKLY_HOURS_ENABLED','true'),
  ('TEST-RPC-WEEKLY','SERVICES_ENABLED','ALMUERZO');
insert into public.booking_capacity_slots(client_id,service,weekday,slot_time,capacity) values
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'16:00',1),
  ('TEST-RPC-WEEKLY','ALMUERZO',0,'17:00',1);
