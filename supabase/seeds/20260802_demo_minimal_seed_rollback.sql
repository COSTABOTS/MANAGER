-- Phase 2C.1 rollback. Deletes only rows whose fixed identifiers and values
-- still match the reviewed seed. REVIEW ONLY; do not run without approval.
-- Scope note: CB-DEMO-002 technical seed, 16 rows, dynamic date resolved to
-- 2026-08-16. Demo remains on Sheets; Safari has no Hospitality rows. Do not
-- rerun the seed. This rollback is guarded; load all 30 real tables before cutover.

begin;

do $guard$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public."CLIENTES"
    where client_id = 'CB-DEMO-002'
      and reservation_store = 'sheets'
      and reservation_shadow_read = false
  ) then
    raise exception 'DEMO_ROLLBACK_ABORT: tenant missing or operational flags changed';
  end if;

  if exists (
    select 1 from public.reservations
    where client_id = 'CB-DEMO-002'
      and table_id in (
        '2c110001-0000-4000-8000-000000000001',
        '2c110002-0000-4000-8000-000000000002',
        '2c110003-0000-4000-8000-000000000003'
      )
      and id not in (
        '2c130001-0000-4000-8000-000000000001',
        '2c130002-0000-4000-8000-000000000002',
        '2c130003-0000-4000-8000-000000000003'
      )
  ) then
    raise exception 'DEMO_ROLLBACK_ABORT: non-seed reservations reference seed tables';
  end if;

  select count(*) into v_count
  from public.reservations
  where client_id = 'CB-DEMO-002'
    and source_channel = 'demo'
    and legacy_source = 'DEMO'
    and customer_phone is null
    and special_request = 'Fixture sintético Fase 2C.1'
    and id in (
      '2c130001-0000-4000-8000-000000000001',
      '2c130002-0000-4000-8000-000000000002',
      '2c130003-0000-4000-8000-000000000003'
    );
  if v_count <> 3 then
    raise exception 'DEMO_ROLLBACK_ABORT: expected 3 unchanged synthetic reservations, found %', v_count;
  end if;

  select count(*) into v_count from public.booking_capacity_slots
  where client_id = 'CB-DEMO-002'
    and id between '2c100001-0000-4000-8000-000000000001' and '2c100008-0000-4000-8000-000000000008'
    and service is null and weekday is null and active and valid_from is null and valid_until is null;
  if v_count <> 8 then
    raise exception 'DEMO_ROLLBACK_ABORT: capacity seed rows are missing or changed';
  end if;

  select count(*) into v_count from public.restaurant_tables
  where client_id = 'CB-DEMO-002'
    and id in (
      '2c110001-0000-4000-8000-000000000001',
      '2c110002-0000-4000-8000-000000000002',
      '2c110003-0000-4000-8000-000000000003'
    )
    and active;
  if v_count <> 3 then
    raise exception 'DEMO_ROLLBACK_ABORT: table seed rows are missing or changed';
  end if;

  select count(*) into v_count from public.booking_day_controls
  where client_id = 'CB-DEMO-002'
    and id in (
      '2c120001-0000-4000-8000-000000000001',
      '2c120002-0000-4000-8000-000000000002'
    )
    and notes = 'PHASE_2C1_DEMO_SEED: Sheets FULLY BOOKED';
  if v_count <> 2 then
    raise exception 'DEMO_ROLLBACK_ABORT: day-control seed rows are missing or changed';
  end if;
end
$guard$;

delete from public.reservations
where client_id = 'CB-DEMO-002'
  and source_channel = 'demo'
  and legacy_source = 'DEMO'
  and special_request = 'Fixture sintético Fase 2C.1'
  and id in (
    '2c130001-0000-4000-8000-000000000001',
    '2c130002-0000-4000-8000-000000000002',
    '2c130003-0000-4000-8000-000000000003'
  );

delete from public.booking_day_controls
where client_id = 'CB-DEMO-002'
  and notes = 'PHASE_2C1_DEMO_SEED: Sheets FULLY BOOKED'
  and id in ('2c120001-0000-4000-8000-000000000001', '2c120002-0000-4000-8000-000000000002');

delete from public.restaurant_tables
where client_id = 'CB-DEMO-002'
  and id in (
    '2c110001-0000-4000-8000-000000000001',
    '2c110002-0000-4000-8000-000000000002',
    '2c110003-0000-4000-8000-000000000003'
  );

delete from public.booking_capacity_slots
where client_id = 'CB-DEMO-002'
  and id in (
    '2c100001-0000-4000-8000-000000000001',
    '2c100002-0000-4000-8000-000000000002',
    '2c100003-0000-4000-8000-000000000003',
    '2c100004-0000-4000-8000-000000000004',
    '2c100005-0000-4000-8000-000000000005',
    '2c100006-0000-4000-8000-000000000006',
    '2c100007-0000-4000-8000-000000000007',
    '2c100008-0000-4000-8000-000000000008'
  );

commit;
