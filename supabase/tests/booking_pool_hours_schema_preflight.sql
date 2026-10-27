-- READ ONLY. Prepared for a later, separately authorized schema inspection.
-- Do not run as part of CI against production; no tenant rows or personal data are selected.
select current_database() as database_name, current_setting('server_version') as postgres_version;

select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'CLIENTES' and column_name = 'client_id';

select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = to_regclass('public."CLIENTES"')
  and (contype in ('p', 'u') or pg_get_constraintdef(oid) like '%client_id%');

select to_regclass('public.booking_pool_hours') as existing_pool_table,
       to_regprocedure('public.get_booking_pool_hours_snapshot(text)') as existing_read_rpc,
       to_regprocedure('public.replace_booking_pool_hours(text,text,text,text)') as existing_save_rpc,
       to_regprocedure('public.gen_random_uuid()') as public_uuid_function,
       to_regprocedure('pg_catalog.gen_random_uuid()') as catalog_uuid_function;

select rolname, rolbypassrls
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role')
order by rolname;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('CLIENTES', 'SETTINGS', 'booking_pool_hours');
