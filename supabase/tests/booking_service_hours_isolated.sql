-- Isolated-database smoke tests for 20261025120000_booking_service_hours.sql.
-- Run only after applying the migration to a disposable database with an
-- existing CLIENTES row referenced by :client_id. The transaction is rolled
-- back and never targets production.

begin;

select public.replace_booking_service_hours(
  :'client_id',
  (
    select jsonb_agg(jsonb_build_object(
      'weekday', d.weekday,
      'service', s.service,
      'enabled', (s.service = 'ALMUERZO' and d.weekday = 1),
      'start_time', case when s.service = 'ALMUERZO' and d.weekday = 1 then '12:00'::time else null end,
      'end_time', case when s.service = 'ALMUERZO' and d.weekday = 1 then '16:00'::time else null end
    ))
    from generate_series(0, 6) as d(weekday)
    cross join unnest(array['DESAYUNO', 'ALMUERZO', 'CENA']) as s(service)
  )
);

select count(*) = 21 as has_21_rules
from public.booking_service_hours
where client_id = :'client_id';
select public.booking_service_hours_is_complete(:'client_id') as is_complete;

-- The table constraints assert invalid weekday/service, disabled rows with
-- times, equal/reversed windows and duplicate combinations. The replace
-- function rejects partial input before deleting existing rows:
do $$
begin
  perform public.replace_booking_service_hours(
    :'client_id',
    jsonb_build_array(jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', false, 'start_time', null, 'end_time', null))
  );
  raise exception 'expected WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES';
exception when others then
  if sqlerrm <> 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES' then raise; end if;
end;
$$;

rollback;
