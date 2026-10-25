-- psql harness for an ISOLATED disposable database only.
-- Invoke with: psql ... -v client_id='FIXTURE_CLIENT_ID' -f this-file.sql
-- The migration must already be applied in that disposable database.
\set ON_ERROR_STOP on
\if :{?client_id}
\else
  select 1 / 0; -- deliberate failure; ON_ERROR_STOP aborts without a fixture
\endif

select set_config('weekly_test.client_id', :'client_id', false);
begin;

-- Exactly 21 valid rules: every weekday and every service.
select public.replace_booking_service_hours(
  current_setting('weekly_test.client_id'),
  (select jsonb_agg(jsonb_build_object(
    'weekday', d.weekday, 'service', s.service,
    'enabled', (s.service = 'ALMUERZO' and d.weekday = 1),
    'start_time', case when s.service = 'ALMUERZO' and d.weekday = 1 then '12:00'::time else null end,
    'end_time', case when s.service = 'ALMUERZO' and d.weekday = 1 then '16:00'::time else null end
  ) order by d.weekday, s.service)
   from generate_series(0, 6) d(weekday)
   cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service))
);

do $$
declare n integer;
begin
  select count(*) into n from public.booking_service_hours where client_id = current_setting('weekly_test.client_id');
  if n <> 21 or not public.booking_service_hours_is_complete(current_setting('weekly_test.client_id')) then
    raise exception 'valid 21-rule fixture was not stored completely';
  end if;
end $$;

-- Any expected rejection must leave the original 21 rows intact.
do $$
declare before_count integer; after_count integer; rejected boolean;
begin
  select count(*) into before_count from public.booking_service_hours where client_id = current_setting('weekly_test.client_id');
  rejected := false;
  begin
    perform public.replace_booking_service_hours(current_setting('weekly_test.client_id'),
      (select jsonb_agg(jsonb_build_object('weekday', d.weekday, 'service', s.service, 'enabled', false, 'start_time', null, 'end_time', null))
       from generate_series(0, 6) d(weekday) cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)
       where not (d.weekday = 6 and s.service = 'CENA')));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception '20 rules unexpectedly accepted'; end if;
  select count(*) into after_count from public.booking_service_hours where client_id = current_setting('weekly_test.client_id');
  if after_count <> before_count then raise exception '20-rule rejection changed original rows'; end if;
end $$;

-- 22 rules and duplicate combinations must fail explicitly.
do $$
declare rejected boolean;
begin
  rejected := false;
  begin
    perform public.replace_booking_service_hours(current_setting('weekly_test.client_id'),
      (select jsonb_agg(x) from (
        select jsonb_build_object('weekday', d.weekday, 'service', s.service, 'enabled', false, 'start_time', null, 'end_time', null) x
        from generate_series(0, 6) d(weekday) cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)
        union all select jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', false, 'start_time', null, 'end_time', null)
      ) q));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception '22 rules unexpectedly accepted'; end if;
  rejected := false;
  begin
    perform public.replace_booking_service_hours(current_setting('weekly_test.client_id'),
      (select jsonb_agg(x) from (
        select jsonb_build_object('weekday', d.weekday, 'service', s.service, 'enabled', false, 'start_time', null, 'end_time', null) x
        from generate_series(0, 6) d(weekday) cross join unnest(array['DESAYUNO','ALMUERZO','CENA']) s(service)
        where not (d.weekday = 6 and s.service = 'CENA')
        union all select jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', false, 'start_time', null, 'end_time', null)
      ) q));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'duplicate combinations unexpectedly accepted'; end if;
end $$;

-- Invalid weekday/service/window/disabled-time payloads must fail and preserve data.
do $$
declare payload jsonb; before_count integer; after_count integer; rejected boolean;
begin
  select count(*) into before_count from public.booking_service_hours where client_id = current_setting('weekly_test.client_id');
  foreach payload in array array[
    jsonb_build_array(jsonb_build_object('weekday', 7, 'service', 'CENA', 'enabled', false, 'start_time', null, 'end_time', null)),
    jsonb_build_array(jsonb_build_object('weekday', 0, 'service', 'OTRO', 'enabled', false, 'start_time', null, 'end_time', null)),
    jsonb_build_array(jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', true, 'start_time', '22:00', 'end_time', '02:00')),
    jsonb_build_array(jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', true, 'start_time', '19:00', 'end_time', '19:00')),
    jsonb_build_array(jsonb_build_object('weekday', 0, 'service', 'CENA', 'enabled', false, 'start_time', '19:00', 'end_time', '23:00'))
  ] loop
    rejected := false;
    begin
      perform public.replace_booking_service_hours(current_setting('weekly_test.client_id'), payload);
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'invalid payload unexpectedly accepted: %', payload; end if;
  end loop;
  select count(*) into after_count from public.booking_service_hours where client_id = current_setting('weekly_test.client_id');
  if after_count <> before_count then raise exception 'constraint rejection changed original rows'; end if;
end $$;

-- Direct table constraints are checked separately from the 21-rule gate.
do $$
declare rejected boolean; bad record;
begin
  for bad in select * from (values
    (7::smallint, 'CENA'::text, false, null::time, null::time),
    (0::smallint, 'OTRO'::text, false, null::time, null::time),
    (0::smallint, 'CENA'::text, true, '22:00'::time, '02:00'::time),
    (0::smallint, 'CENA'::text, true, '19:00'::time, '19:00'::time),
    (0::smallint, 'CENA'::text, false, '19:00'::time, '23:00'::time)
  ) as invalid(weekday, service, enabled, start_time, end_time) loop
    rejected := false;
    begin
      insert into public.booking_service_hours(client_id, weekday, service, enabled, start_time, end_time)
      values (current_setting('weekly_test.client_id'), bad.weekday, bad.service, bad.enabled, bad.start_time, bad.end_time);
    exception when others then rejected := true;
    end;
    if not rejected then raise exception 'table constraint unexpectedly accepted invalid rule'; end if;
  end loop;
end $$;

-- Public roles must not access the table or privileged functions.
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      raise exception 'required role % is missing from isolated Supabase fixture', role_name;
    end if;
    if has_table_privilege(role_name, 'public.booking_service_hours', 'SELECT') then raise exception '% has SELECT privilege', role_name; end if;
    if has_function_privilege(role_name, 'public.replace_booking_service_hours(text,jsonb)', 'EXECUTE') then raise exception '% can execute replace function', role_name; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.replace_booking_service_hours(text,jsonb)', 'EXECUTE') then
    raise exception 'service_role lacks replace function EXECUTE';
  end if;
end $$;

-- Concurrency requires two sessions. Session A keeps a replacement open;
-- session B calls the same function for the same client and must wait for the
-- advisory transaction lock. This is deliberately documented as a two-session
-- check rather than reported as a single-session PASS.

rollback;
