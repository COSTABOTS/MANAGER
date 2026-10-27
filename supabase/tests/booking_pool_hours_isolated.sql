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

begin;
insert into public."CLIENTES" (client_id) values ('TEST-POOL-OTHER');
create table public."SETTINGS" (client_id text, value text);
create table public.booking_capacity_slots (client_id text, places integer);
insert into public."SETTINGS" values ('TEST-WEEKLY-HOURS', 'unchanged');
insert into public.booking_capacity_slots values ('TEST-WEEKLY-HOURS', 0);

do $$ begin
  if has_table_privilege('anon', 'public.booking_pool_hours', 'SELECT')
     or has_table_privilege('authenticated', 'public.booking_pool_hours', 'INSERT')
     or not has_table_privilege('service_role', 'public.booking_pool_hours', 'SELECT')
     or has_function_privilege('anon', 'public.get_booking_pool_hours_snapshot(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.replace_booking_pool_hours(text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.replace_booking_pool_hours(text,text,text,text)', 'EXECUTE')
     or not (select relrowsecurity from pg_class where oid = 'public.booking_pool_hours'::regclass) then
    raise exception 'Pool hours permissions or RLS are incorrect';
  end if;
  if public.get_booking_pool_hours_snapshot('TEST-WEEKLY-HOURS')->>'configured' <> 'false'
     or public.get_booking_pool_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision' is not null then
    raise exception 'Unconfigured tenant must not receive invented hours';
  end if;
end $$;

set local role service_role;
select public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '10:00', '19:00', null);
reset role;

do $$ declare v_revision text; begin
  select revision::text into v_revision from public.booking_pool_hours where client_id = 'TEST-WEEKLY-HOURS';
  if v_revision is null
     or public.get_booking_pool_hours_snapshot('TEST-WEEKLY-HOURS')->>'opening_time' <> '10:00'
     or public.get_booking_pool_hours_snapshot('TEST-POOL-OTHER')->>'configured' <> 'false' then
    raise exception 'First save, readback or tenant separation failed';
  end if;
  begin
    perform public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '11:00', '20:00', null);
    raise exception 'Stale revision was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'POOL_HOURS_CONFLICT' then raise; end if;
  end;
  begin
    perform public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '19:00', '19:00', v_revision);
    raise exception 'Equal hours were accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'POOL_HOURS_INVALID' then raise; end if;
  end;
  begin
    perform public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '20:00', '10:00', v_revision);
    raise exception 'Overnight hours were accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'POOL_HOURS_INVALID' then raise; end if;
  end;
  begin
    perform public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '25:00', '26:00', v_revision);
    raise exception 'Invalid hours were accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'POOL_HOURS_INVALID' then raise; end if;
  end;
  if (select opening_time::text from public.booking_pool_hours where client_id = 'TEST-WEEKLY-HOURS') <> '10:00:00'
     or (select count(*) from public.booking_pool_hours where client_id = 'TEST-WEEKLY-HOURS') <> 1 then
    raise exception 'Rejected save changed stored hours';
  end if;
  perform public.replace_booking_pool_hours('TEST-WEEKLY-HOURS', '09:00', '18:00', v_revision);
  if (select revision::text from public.booking_pool_hours where client_id = 'TEST-WEEKLY-HOURS') = v_revision then
    raise exception 'Successful update did not advance revision';
  end if;
  if (select count(*) from public."SETTINGS" where value = 'unchanged') <> 1
     or (select count(*) from public.booking_capacity_slots where places = 0) <> 1 then
    raise exception 'Pool hours save modified legacy settings or capacity';
  end if;
end $$;
rollback;
