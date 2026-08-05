-- Phase 2C.1 postflight. Read-only checks; expected values are documented inline.
-- Scope note: CB-DEMO-002 technical, non-operational seed; 16 rows inserted;
-- dynamic date resolved to 2026-08-16. Demo remains on Sheets, Safari has no
-- Hospitality rows, rollback is available, and the seed must not be run again.
-- Before cutover, load all 30 real active Demo tables.

-- Exactly one operational Demo tenant, still on Sheets with shadow read disabled.
select client_id, rest_name, reservation_store, reservation_shadow_read, sheet_id
from public."CLIENTES"
where client_id = 'CB-DEMO-002';

-- Safari must remain on Sheets. Expected: every Safari row has sheets / false.
select client_id, rest_name, reservation_store, reservation_shadow_read
from public."CLIENTES"
where client_id ilike '%SAFARI%' or rest_name ilike '%SAFARI%'
order by client_id;

-- Expected Demo counts: capacity=8, tables=3, controls=2, reservations=3; all others=0.
select 'restaurant_customers' as object_name, count(*) as row_count from public.restaurant_customers where client_id = 'CB-DEMO-002'
union all select 'restaurant_tables', count(*) from public.restaurant_tables where client_id = 'CB-DEMO-002'
union all select 'reservable_resources', count(*) from public.reservable_resources where client_id = 'CB-DEMO-002'
union all select 'booking_capacity_slots', count(*) from public.booking_capacity_slots where client_id = 'CB-DEMO-002'
union all select 'booking_day_controls', count(*) from public.booking_day_controls where client_id = 'CB-DEMO-002'
union all select 'booking_blocks', count(*) from public.booking_blocks where client_id = 'CB-DEMO-002'
union all select 'reservations', count(*) from public.reservations where client_id = 'CB-DEMO-002'
union all select 'feedbacks', count(*) from public.feedbacks where client_id = 'CB-DEMO-002'
union all select 'booking_idempotency', count(*) from public.booking_idempotency where client_id = 'CB-DEMO-002';

-- Expected: zero Hospitality rows for every tenant other than the selected Demo.
select 'restaurant_customers' as object_name, count(*) as other_tenant_rows from public.restaurant_customers where client_id <> 'CB-DEMO-002'
union all select 'restaurant_tables', count(*) from public.restaurant_tables where client_id <> 'CB-DEMO-002'
union all select 'reservable_resources', count(*) from public.reservable_resources where client_id <> 'CB-DEMO-002'
union all select 'booking_capacity_slots', count(*) from public.booking_capacity_slots where client_id <> 'CB-DEMO-002'
union all select 'booking_day_controls', count(*) from public.booking_day_controls where client_id <> 'CB-DEMO-002'
union all select 'booking_blocks', count(*) from public.booking_blocks where client_id <> 'CB-DEMO-002'
union all select 'reservations', count(*) from public.reservations where client_id <> 'CB-DEMO-002'
union all select 'feedbacks', count(*) from public.feedbacks where client_id <> 'CB-DEMO-002'
union all select 'booking_idempotency', count(*) from public.booking_idempotency where client_id <> 'CB-DEMO-002';

-- Expected: three recognizable synthetic rows, no phone and no resource.
select public_reference, booking_date, booking_time, status, legacy_status,
       source_channel, legacy_source, customer_phone is null as phone_is_null,
       table_id, resource_id
from public.reservations
where client_id = 'CB-DEMO-002' and source_channel = 'demo'
order by booking_time, id;

-- Expected: zero cross-tenant references.
select count(*) as cross_tenant_table_references
from public.reservations r
join public.restaurant_tables t on t.id = r.table_id
where r.client_id <> t.client_id;

select count(*) as cross_tenant_resource_references
from public.reservations r
join public.reservable_resources rr on rr.id = r.resource_id
where r.client_id <> rr.client_id;

-- Expected: RLS enabled, no policies, no anon/authenticated privileges on all 9 tables.
select c.relname,
       c.relrowsecurity as rls_enabled,
       count(p.policyname) as policy_count,
       has_table_privilege('anon', format('public.%I', c.relname), 'select,insert,update,delete') as anon_has_dml,
       has_table_privilege('authenticated', format('public.%I', c.relname), 'select,insert,update,delete') as authenticated_has_dml
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname in (
  'restaurant_customers', 'restaurant_tables', 'reservable_resources',
  'booking_capacity_slots', 'booking_day_controls', 'booking_blocks',
  'reservations', 'feedbacks', 'booking_idempotency'
)
group by c.relname, c.relrowsecurity
order by c.relname;

-- Resolver disconnection is a source-code invariant and cannot be proven by SQL.
-- Verify separately with the read-only command documented in the phase report.
