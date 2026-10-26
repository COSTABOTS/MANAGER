begin;

-- Revision and rows are computed from the same database snapshot. Only the
-- two service-role RPCs below may expose this internal helper.
create function public.booking_service_hours_state(p_client_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rules jsonb;
  v_canonical text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', weekday, 'service', service, 'enabled', enabled,
      'start_time', start_time, 'end_time', end_time
    ) order by weekday, service), '[]'::jsonb),
    coalesce(string_agg(
      weekday::text || '|' || service || '|' || case when enabled then '1' else '0' end || '|' ||
      coalesce(start_time::text, '-') || '|' || coalesce(end_time::text, '-'),
      ';' order by weekday, service
    ), '')
  into v_rules, v_canonical
  from public.booking_service_hours
  where client_id = p_client_id;

  return jsonb_build_object(
    'rules', v_rules,
    'revision', encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex')
  );
end;
$$;

revoke all on function public.booking_service_hours_state(text) from public, anon, authenticated, service_role;

create function public.get_booking_service_hours_snapshot(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended(p_client_id, 0));
  return public.booking_service_hours_state(p_client_id);
end;
$$;

revoke all on function public.get_booking_service_hours_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_booking_service_hours_snapshot(text) to service_role;

-- The two-argument function must not remain callable: it would bypass CAS.
revoke all on function public.replace_booking_service_hours(text, jsonb) from public, anon, authenticated, service_role;
drop function public.replace_booking_service_hours(text, jsonb);

create function public.replace_booking_service_hours(
  p_client_id text,
  p_rules jsonb,
  p_expected_revision text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current_revision text;
  v_count integer;
  v_distinct integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_client_id, 0));
  v_current_revision := public.booking_service_hours_state(p_client_id)->>'revision';
  if p_expected_revision is null or p_expected_revision <> v_current_revision then
    raise exception using message = 'WEEKLY_HOURS_CONFLICT', errcode = 'P0001';
  end if;

  select count(*), count(distinct (weekday, service))
    into v_count, v_distinct
  from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb)) as rules(
    weekday smallint, service text, enabled boolean,
    start_time time, end_time time
  );
  if v_count <> 21 or v_distinct <> 21 then
    raise exception using message = 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES', errcode = 'P0001';
  end if;

  delete from public.booking_service_hours where client_id = p_client_id;
  insert into public.booking_service_hours(client_id, weekday, service, enabled, start_time, end_time)
  select p_client_id, rules.weekday, rules.service, rules.enabled, rules.start_time, rules.end_time
  from jsonb_to_recordset(p_rules) as rules(
    weekday smallint, service text, enabled boolean,
    start_time time, end_time time
  );
  return public.booking_service_hours_state(p_client_id)->>'revision';
end;
$$;

revoke all on function public.replace_booking_service_hours(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_booking_service_hours(text, jsonb, text) to service_role;

commit;
