-- Run only against the disposable weekly_test PostgreSQL 16 fixture.
\set ON_ERROR_STOP on
do $$ begin
  if current_database() <> 'weekly_test'
     or current_setting('server_version_num')::integer / 10000 <> 16
     or not (
       inet_server_addr() = inet '127.0.0.1'
       or (
         inet_server_addr() <<= inet '172.16.0.0/12'
         and current_setting('costabots.weekly_test', true) = 'gha-isolated-postgres16'
         and host(inet_server_addr()) = current_setting('costabots.weekly_server_ip', true)
       )
     ) then
    raise exception 'Disposable local PostgreSQL 16 weekly_test required';
  end if;
end $$;

do $$
declare
  v_table oid := to_regclass('public.booking_pool_hours');
  v_owner oid;
  v_acl aclitem[];
  v_service_role oid;
  v_function oid;
  v_role text;
begin
  if v_table is null then raise exception 'Pool hours table missing'; end if;
  select relowner, relacl into v_owner, v_acl from pg_class where oid = v_table;
  select oid into v_service_role from pg_roles where rolname = 'service_role';

  if not has_table_privilege('service_role', v_table, 'SELECT')
     or not has_table_privilege('service_role', v_table, 'INSERT')
     or not has_table_privilege('service_role', v_table, 'UPDATE')
     or has_table_privilege('service_role', v_table, 'DELETE')
     or has_table_privilege('service_role', v_table, 'TRUNCATE')
     or has_table_privilege('service_role', v_table, 'REFERENCES')
     or has_table_privilege('service_role', v_table, 'TRIGGER') then
    raise exception 'Pool hours effective privileges incorrect';
  end if;
  if exists (
    select 1 from aclexplode(coalesce(v_acl, acldefault('r', v_owner))) a
    where (a.grantee = v_service_role and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE'))
       or a.grantee = 0
  ) then
    raise exception 'Pool hours direct ACL incorrect';
  end if;
  if not (select relrowsecurity from pg_class where oid = v_table)
     or exists (select 1 from pg_policies where schemaname='public' and tablename='booking_pool_hours') then
    raise exception 'Pool hours RLS or policies incorrect';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, v_table, 'SELECT')
       or has_table_privilege(v_role, v_table, 'INSERT')
       or has_table_privilege(v_role, v_table, 'UPDATE')
       or has_table_privilege(v_role, v_table, 'DELETE')
       or has_table_privilege(v_role, v_table, 'TRUNCATE')
       or has_table_privilege(v_role, v_table, 'REFERENCES')
       or has_table_privilege(v_role, v_table, 'TRIGGER') then
      raise exception 'Public roles gained table access';
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.booking_service_hours', 'DELETE') then
    raise exception 'Unrelated weekly-hours table privileges changed';
  end if;

  foreach v_function in array array[
    to_regprocedure('public.get_booking_pool_hours_snapshot(text)')::oid,
    to_regprocedure('public.replace_booking_pool_hours(text,text,text,text)')::oid
  ] loop
    if v_function is null
       or not has_function_privilege('service_role', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = v_function and a.grantee = 0
       ) then
      raise exception 'Pool hours RPC permissions incorrect';
    end if;
  end loop;
end $$;
-- Prove the two existing RPCs still work as service_role after narrowing the table ACL.
begin;
set local role service_role;
do $$
declare
  v_saved jsonb;
begin
  if public.get_booking_pool_hours_snapshot('TEST-WEEKLY-HOURS')->>'configured' <> 'false' then
    raise exception 'Unexpected existing pool configuration in disposable test';
  end if;
  v_saved := public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '10:00', '19:00', null);
  if v_saved->>'configured' <> 'true'
     or public.get_booking_pool_hours_snapshot('TEST-WEEKLY-HOURS')->>'opening_time' <> '10:00' then
    raise exception 'Pool hours RPC read/write failed after ACL correction';
  end if;
end $$;
rollback;