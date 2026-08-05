-- Phase 2C.1: minimal, reversible read-test data for the operational Demo tenant.
-- REVIEW ONLY. Do not run until explicitly approved.
-- Execution record: tenant CB-DEMO-002; technical, non-operational seed; 16 rows
-- inserted; dynamic test date resolved to 2026-08-16. Demo remains on Sheets,
-- Safari has no Hospitality rows, and a guarded rollback is available. Do not
-- execute this seed a second time. Load all 30 real active tables before cutover.
-- This seed does not replicate Demo's full operating configuration. Its only
-- purpose is to validate real SupabaseReservationStore reads. Before cutover,
-- all 30 active restaurant tables from Sheets must be loaded separately.

begin;

do $guard$
declare
  v_tenant_count integer;
  v_store text;
  v_shadow boolean;
begin
  select count(*), min(reservation_store), bool_or(reservation_shadow_read)
    into v_tenant_count, v_store, v_shadow
  from public."CLIENTES"
  where client_id = 'CB-DEMO-002';

  if v_tenant_count <> 1 then
    raise exception 'DEMO_SEED_ABORT: expected exactly one CB-DEMO-002 tenant, found %', v_tenant_count;
  end if;
  if v_store is distinct from 'sheets' then
    raise exception 'DEMO_SEED_ABORT: reservation_store must remain sheets';
  end if;
  if v_shadow is distinct from false then
    raise exception 'DEMO_SEED_ABORT: reservation_shadow_read must remain false';
  end if;

  if exists (
    select 1 from public.restaurant_customers where client_id = 'CB-DEMO-002'
    union all select 1 from public.restaurant_tables where client_id = 'CB-DEMO-002'
    union all select 1 from public.reservable_resources where client_id = 'CB-DEMO-002'
    union all select 1 from public.booking_capacity_slots where client_id = 'CB-DEMO-002'
    union all select 1 from public.booking_day_controls where client_id = 'CB-DEMO-002'
    union all select 1 from public.booking_blocks where client_id = 'CB-DEMO-002'
    union all select 1 from public.reservations where client_id = 'CB-DEMO-002'
    union all select 1 from public.feedbacks where client_id = 'CB-DEMO-002'
    union all select 1 from public.booking_idempotency where client_id = 'CB-DEMO-002'
  ) then
    raise exception 'DEMO_SEED_ABORT: Hospitality rows already exist for CB-DEMO-002';
  end if;
end
$guard$;

insert into public.booking_capacity_slots
  (id, client_id, service, weekday, slot_time, capacity, active, valid_from, valid_until)
values
  ('2c100001-0000-4000-8000-000000000001', 'CB-DEMO-002', null, null, time '18:00', 20, true, null, null),
  ('2c100002-0000-4000-8000-000000000002', 'CB-DEMO-002', null, null, time '18:30', 20, true, null, null),
  ('2c100003-0000-4000-8000-000000000003', 'CB-DEMO-002', null, null, time '19:00', 40, true, null, null),
  ('2c100004-0000-4000-8000-000000000004', 'CB-DEMO-002', null, null, time '19:30', 40, true, null, null),
  ('2c100005-0000-4000-8000-000000000005', 'CB-DEMO-002', null, null, time '20:00', 40, true, null, null),
  ('2c100006-0000-4000-8000-000000000006', 'CB-DEMO-002', null, null, time '20:30', 40, true, null, null),
  ('2c100007-0000-4000-8000-000000000007', 'CB-DEMO-002', null, null, time '21:00', 40, true, null, null),
  ('2c100008-0000-4000-8000-000000000008', 'CB-DEMO-002', null, null, time '21:30', 40, true, null, null);

insert into public.restaurant_tables
  (id, client_id, legacy_table_id, label, zone, capacity, active, display_order)
values
  ('2c110001-0000-4000-8000-000000000001', 'CB-DEMO-002', 'MESA-1781373334063', 'S1',  'interior', 2, true, 1),
  ('2c110002-0000-4000-8000-000000000002', 'CB-DEMO-002', 'MESA-1781374270205', 'S2',  'interior', 6, true, 1),
  ('2c110003-0000-4000-8000-000000000003', 'CB-DEMO-002', 'MESA-1781377147443', 'T30', 'terraza',  2, true, 23);

insert into public.booking_day_controls
  (id, client_id, service, booking_date, status, fully_booked, capacity_override, notes)
values
  ('2c120001-0000-4000-8000-000000000001', 'CB-DEMO-002', null, date '2026-12-25', 'open', true, null, 'PHASE_2C1_DEMO_SEED: Sheets FULLY BOOKED'),
  ('2c120002-0000-4000-8000-000000000002', 'CB-DEMO-002', null, date '2026-12-31', 'open', true, null, 'PHASE_2C1_DEMO_SEED: Sheets FULLY BOOKED');

with seed_config as (
  select current_date + 14 as test_date
)
insert into public.reservations
  (id, client_id, legacy_reservation_id, public_reference, booking_date, booking_time,
   service, customer_id, customer_name, customer_phone, pax, locale, special_request,
   status, legacy_status, source_channel, legacy_source, table_id, resource_id,
   room, arrived, feedback_sent, pre_dinner_sent, balinese_package,
   legacy_created_at, legacy_updated_at, legacy_locale)
select v.id::uuid, 'CB-DEMO-002', v.legacy_reservation_id,
       format('%s-%s', v.public_reference_prefix, to_char(c.test_date, 'YYYYMMDD')),
       c.test_date, v.booking_time::time, 'CENA', null, v.customer_name, null, 2,
       'ES', 'Fixture sintético Fase 2C.1', v.status, v.legacy_status,
       'demo', 'DEMO', v.table_id::uuid, null, null, false, false, false, null,
       null, null, 'ES'
from seed_config c
cross join (values
  ('2c130001-0000-4000-8000-000000000001', 'DEMO-2C1-CONFIRMED', 'DEMO-2C1-CONFIRMED', '18:00', 'Cliente Demo Confirmado', 'confirmed', 'CONFIRMADA', '2c110001-0000-4000-8000-000000000001'),
  ('2c130002-0000-4000-8000-000000000002', 'DEMO-2C1-PENDING', 'DEMO-2C1-PENDING', '18:30', 'Cliente Demo Pendiente', 'pending', 'PENDIENTE', '2c110003-0000-4000-8000-000000000003'),
  ('2c130003-0000-4000-8000-000000000003', 'DEMO-2C1-CANCELLED', 'DEMO-2C1-CANCELLED', '19:00', 'Cliente Demo Cancelado', 'cancelled', 'CANCELADA', null)
) as v(id, legacy_reservation_id, public_reference_prefix, booking_time, customer_name, status, legacy_status, table_id);

commit;
