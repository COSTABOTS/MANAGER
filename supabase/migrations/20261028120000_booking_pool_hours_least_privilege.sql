-- Narrow only the pool-hours table ACL. Do not change database-wide defaults.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_table oid;
  v_owner oid;
begin
  select c.oid, c.relowner into v_table, v_owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'booking_pool_hours' and c.relkind = 'r';

  if v_table is null or to_regrole('service_role') is null then
    raise exception 'POOL_HOURS_PERMISSION_PREREQUISITE_MISSING';
  end if;
  if pg_has_role('service_role', v_owner, 'USAGE') then
    raise exception 'POOL_HOURS_SERVICE_ROLE_INHERITS_OWNER';
  end if;
end $$;

revoke all privileges on table public.booking_pool_hours from service_role;
grant select, insert, update on table public.booking_pool_hours to service_role;

do $$
declare
  v_table oid;
  v_owner oid;
  v_acl aclitem[];
  v_service_role oid;
  v_maintain boolean := false;
  v_role text;
begin
  select c.oid, c.relowner, c.relacl into v_table, v_owner, v_acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'booking_pool_hours';
  select oid into v_service_role from pg_roles where rolname = 'service_role';

  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE')
     or has_table_privilege('service_role', v_table, 'DELETE')
     or has_table_privilege('service_role', v_table, 'TRUNCATE')
     or has_table_privilege('service_role', v_table, 'REFERENCES')
     or has_table_privilege('service_role', v_table, 'TRIGGER') then
    raise exception 'POOL_HOURS_SERVICE_ROLE_EFFECTIVE_PRIVILEGES_INVALID';
  end if;

  if current_setting('server_version_num')::integer >= 170000 then
    execute 'select has_table_privilege(''service_role'', ''public.booking_pool_hours'', ''MAINTAIN'')'
      into v_maintain;
    if v_maintain then
      raise exception 'POOL_HOURS_SERVICE_ROLE_MAINTAIN_REMAINS';
    end if;
  end if;

  if exists (
    select 1 from aclexplode(coalesce(v_acl, acldefault('r', v_owner))) a
    where (a.grantee = v_service_role and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE'))
       or a.grantee = 0
  ) then
    raise exception 'POOL_HOURS_DIRECT_ACL_INVALID';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, v_table, 'SELECT')
       or has_table_privilege(v_role, v_table, 'INSERT')
       or has_table_privilege(v_role, v_table, 'UPDATE')
       or has_table_privilege(v_role, v_table, 'DELETE')
       or has_table_privilege(v_role, v_table, 'TRUNCATE')
       or has_table_privilege(v_role, v_table, 'REFERENCES')
       or has_table_privilege(v_role, v_table, 'TRIGGER') then
      raise exception 'POOL_HOURS_PUBLIC_ROLE_PRIVILEGES_INVALID';
    end if;
    if current_setting('server_version_num')::integer >= 170000 then
      execute format('select has_table_privilege(%L, %L, %L)',
        v_role, 'public.booking_pool_hours', 'MAINTAIN') into v_maintain;
      if v_maintain then
        raise exception 'POOL_HOURS_PUBLIC_ROLE_MAINTAIN_INVALID';
      end if;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = v_table) then
    raise exception 'POOL_HOURS_RLS_DISABLED';
  end if;
end $$;

commit;