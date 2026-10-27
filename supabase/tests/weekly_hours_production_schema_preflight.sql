-- READ ONLY: prepared for a separately authorized production inspection.
-- Catalog metadata only; no tenant rows, settings values or personal data.
-- Run with psql -v ON_ERROR_STOP=1 when separately authorized. A missing
-- required legacy column deliberately fails this read-only preflight.
select current_database() as database_name, current_setting('server_version') as postgres_version;

select n.nspname as schema_name, c.relname as relation_name, c.relkind,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('CLIENTES', 'SETTINGS', 'booking_service_hours', 'booking_pool_hours')
order by c.relname;

select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'CLIENTES' and column_name = 'client_id')
    or (table_name = 'SETTINGS' and column_name in ('id', 'CLIENTE_ID', 'CLAVE', 'VALOR'))
    or table_name in ('booking_service_hours', 'booking_pool_hours'))
order by table_name, ordinal_position;

with required(table_name, column_name) as (
  values ('CLIENTES', 'client_id'),
         ('SETTINGS', 'id'),
         ('SETTINGS', 'CLIENTE_ID'),
         ('SETTINGS', 'CLAVE'),
         ('SETTINGS', 'VALOR')
), missing as (
  select r.table_name, r.column_name
  from required r
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = r.table_name
   and c.column_name = r.column_name
  where c.column_name is null
)
select case when count(*) = 0 then 'PASS'
            else ('MISSING_REQUIRED_COLUMNS: ' ||
                  string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name))::integer::text
       end as required_columns_check
from missing;

select conrelid::regclass::text as relation_name, conname, contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (to_regclass('public."CLIENTES"'), to_regclass('public."SETTINGS"'),
                   to_regclass('public.booking_service_hours'), to_regclass('public.booking_pool_hours'))
order by relation_name, conname;

select schemaname, tablename, policyname, roles, cmd, permissive
from pg_policies
where schemaname = 'public'
  and tablename in ('booking_service_hours', 'booking_pool_hours')
order by tablename, policyname;

select c.relname as relation_name, r.rolname as role_name,
       has_table_privilege(r.oid, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.oid, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.oid, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.oid, c.oid, 'DELETE') as can_delete
from pg_class c cross join pg_roles r
where c.oid in (to_regclass('public.booking_service_hours'), to_regclass('public.booking_pool_hours'))
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by c.relname, r.rolname;

select p.oid::regprocedure::text as signature, p.prosecdef as security_definer,
       p.proconfig as function_config, r.rolname as role_name,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and p.proname in ('hospitality_set_updated_at', 'booking_service_hours_is_complete',
    'booking_service_hours_state', 'get_booking_service_hours_snapshot',
    'replace_booking_service_hours', 'get_booking_pool_hours_snapshot',
    'replace_booking_pool_hours', 'create_hospitality_reservation',
    'create_hospitality_balinese_reservation')
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by signature, role_name;

select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;
