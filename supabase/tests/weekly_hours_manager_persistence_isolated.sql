-- Run only after the isolated fixture and booking_service_hours migration.
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
insert into public."CLIENTES" (client_id) values ('TEST-WEEKLY-OTHER');
do $$ begin
  if exists (select 1 from pg_proc where oid = to_regprocedure('public.replace_booking_service_hours(text,jsonb)')) then
    raise exception 'Unguarded two-argument RPC remains callable';
  end if;
  if has_function_privilege('anon', 'public.replace_booking_service_hours(text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.replace_booking_service_hours(text,jsonb,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.replace_booking_service_hours(text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_booking_service_hours_snapshot(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_booking_service_hours_snapshot(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_booking_service_hours_snapshot(text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.booking_service_hours_state(text)', 'EXECUTE') then
    raise exception 'CAS RPC permissions are incorrect';
  end if;
  if (public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision') <> encode(sha256(''::bytea), 'hex') then
    raise exception 'Empty configuration revision is incorrect';
  end if;
end $$;
create table public."SETTINGS" (client_id text, value text);
create table public.booking_capacity_slots (client_id text, places integer);
insert into public."SETTINGS" values ('TEST-WEEKLY-HOURS', 'unchanged');
insert into public.booking_capacity_slots values ('TEST-WEEKLY-HOURS', 0);

set local role service_role;
select public.replace_booking_service_hours('TEST-WEEKLY-HOURS',
  (select jsonb_agg(jsonb_build_object('weekday', d, 'service', s,
    'enabled', d = 0 and s = 'ALMUERZO',
    'start_time', case when d = 0 and s = 'ALMUERZO' then '11:00' else null end,
    'end_time', case when d = 0 and s = 'ALMUERZO' then '18:00' else null end))
   from generate_series(0, 6) d cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s),
   public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision');
select public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision';
reset role;
select public.replace_booking_service_hours('TEST-WEEKLY-OTHER',
  (select jsonb_agg(jsonb_build_object('weekday', d, 'service', s,
    'enabled', false, 'start_time', null, 'end_time', null))
   from generate_series(0, 6) d cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s),
   public.get_booking_service_hours_snapshot('TEST-WEEKLY-OTHER')->>'revision');

do $$
declare
  old_revision text;
  new_revision text;
  returned_revision text;
  rejected boolean := false;
  changed_rules jsonb;
begin
  old_revision := public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision';
  select jsonb_agg(case when r->>'weekday' = '0' and r->>'service' = 'ALMUERZO'
    then jsonb_set(jsonb_set(r, '{start_time}', '"12:00"'::jsonb), '{end_time}', '"17:00"'::jsonb)
    else r end)
  into changed_rules
  from jsonb_array_elements(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules') r;
  returned_revision := public.replace_booking_service_hours('TEST-WEEKLY-HOURS', changed_rules, old_revision);
  new_revision := public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision';
  if returned_revision <> new_revision or new_revision = old_revision then
    raise exception 'Write revision differs from read revision or did not advance';
  end if;
  begin
    perform public.replace_booking_service_hours('TEST-WEEKLY-HOURS', changed_rules, old_revision);
  exception when sqlstate 'P0001' then
    if sqlerrm = 'WEEKLY_HOURS_CONFLICT' then rejected := true; end if;
  end;
  if not rejected then raise exception 'Stale revision did not produce a conflict'; end if;
  if not exists (select 1 from public.booking_service_hours where client_id = 'TEST-WEEKLY-HOURS'
      and weekday = 0 and service = 'ALMUERZO' and start_time = '12:00' and end_time = '17:00') then
    raise exception 'Stale write changed the winning schedule';
  end if;
  returned_revision := public.replace_booking_service_hours('TEST-WEEKLY-HOURS',
    (select jsonb_agg(case when r->>'weekday' = '0' and r->>'service' = 'ALMUERZO'
      then jsonb_set(jsonb_set(r, '{start_time}', '"11:00"'::jsonb), '{end_time}', '"18:00"'::jsonb)
      else r end)
     from jsonb_array_elements(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules') r),
    new_revision);
  if returned_revision <> public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision' then
    raise exception 'Retry with fresh revision did not return the persisted revision';
  end if;
end $$;

do $$ declare rejected boolean := false; candidate jsonb;
begin
  if (select count(*) from public.booking_service_hours where client_id = 'TEST-WEEKLY-HOURS') <> 21
     or (select count(*) from public.booking_service_hours where client_id = 'TEST-WEEKLY-OTHER') <> 21 then
    raise exception 'Tenant read after save did not return 21 rules each';
  end if;
  if (select jsonb_array_length(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules')) <> 21 then
    raise exception 'Snapshot did not return 21 rules with revision';
  end if;
  if not exists (select 1 from public.booking_service_hours where client_id = 'TEST-WEEKLY-HOURS'
                 and weekday = 0 and service = 'ALMUERZO' and enabled
                 and start_time = '11:00' and end_time = '18:00') then
    raise exception 'Sunday lunch was not persisted';
  end if;
  if exists (select 1 from public.booking_service_hours where client_id = 'TEST-WEEKLY-OTHER' and enabled) then
    raise exception 'The second tenant was modified';
  end if;
  foreach candidate in array array[
    '[]'::jsonb,
    (select jsonb_agg(r) from jsonb_array_elements(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules') with ordinality as x(r,n) where n <= 20),
    (select jsonb_agg(r) from (
      select r from jsonb_array_elements(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules') r
      union all select (public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules')->0
    ) twenty_two)
  ] loop
    rejected := false;
    begin
      perform public.replace_booking_service_hours('TEST-WEEKLY-HOURS', candidate,
        public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision');
    exception when sqlstate 'P0001' then
      if sqlerrm = 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES' then rejected := true; end if;
    end;
    if not rejected then raise exception 'Invalid rule count unexpectedly accepted'; end if;
  end loop;
  rejected := false;
  begin
    perform public.replace_booking_service_hours('TEST-WEEKLY-HOURS',
      (select jsonb_agg(case when r->>'weekday' = '0' and r->>'service' = 'ALMUERZO'
        then jsonb_set(jsonb_set(r, '{start_time}', '"19:00"'::jsonb), '{end_time}', '"11:00"'::jsonb)
        else r end)
       from jsonb_array_elements(public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->'rules') r),
      public.get_booking_service_hours_snapshot('TEST-WEEKLY-HOURS')->>'revision');
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'An inverted window passed the SQL constraint'; end if;
  if (select count(*) from public.booking_service_hours where client_id = 'TEST-WEEKLY-HOURS') <> 21
     or not exists (select 1 from public.booking_service_hours where client_id = 'TEST-WEEKLY-HOURS'
                    and weekday = 0 and service = 'ALMUERZO' and enabled) then
    raise exception 'A rejected save changed existing rules';
  end if;
  if (select value from public."SETTINGS") <> 'unchanged'
     or (select places from public.booking_capacity_slots) <> 0 then
    raise exception 'Legacy settings or capacity marker changed';
  end if;
end $$;
rollback;
