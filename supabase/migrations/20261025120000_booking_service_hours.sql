begin;

create table public.booking_service_hours (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  weekday smallint not null,
  service text not null,
  enabled boolean not null default false,
  start_time time without time zone,
  end_time time without time zone,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_service_hours_weekday_check check (weekday between 0 and 6),
  constraint booking_service_hours_service_check check (service in ('DESAYUNO', 'ALMUERZO', 'CENA')),
  constraint booking_service_hours_window_check check (
    (enabled and start_time is not null and end_time is not null and start_time < end_time)
    or
    (not enabled and start_time is null and end_time is null)
  ),
  constraint booking_service_hours_client_weekday_service_key unique (client_id, weekday, service)
);

create index ix_booking_service_hours_lookup
  on public.booking_service_hours(client_id, weekday, service);

create trigger hospitality_booking_service_hours_updated_at
  before update on public.booking_service_hours
  for each row execute function public.hospitality_set_updated_at();

alter table public.booking_service_hours enable row level security;
revoke all on table public.booking_service_hours from anon, authenticated;
grant all on table public.booking_service_hours to service_role;

-- Activation is deliberately not inserted here. The existing SETTINGS key
-- WEEKLY_HOURS_ENABLED is the explicit per-client gate; absent/false means
-- legacy behavior. A future writer must set it only after all 21 rows pass
-- validate_weekly_hours_config and have been saved atomically.

create or replace function public.booking_service_hours_is_complete(p_client_id text)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select count(*) = 21
    and count(distinct weekday) = 7
    and count(distinct service) = 3
  from public.booking_service_hours
  where client_id = p_client_id;
$$;

revoke all on function public.booking_service_hours_is_complete(text) from public, anon, authenticated;
grant execute on function public.booking_service_hours_is_complete(text) to service_role;

create or replace function public.replace_booking_service_hours(p_client_id text, p_rules jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_distinct integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_client_id, 0));

  select count(*), count(distinct (weekday, service))
    into v_count, v_distinct
  from jsonb_to_recordset(coalesce(p_rules, '[]'::jsonb)) as rules(
    weekday smallint,
    service text,
    enabled boolean,
    start_time time,
    end_time time
  );

  if v_count <> 21 or v_distinct <> 21 then
    raise exception 'WEEKLY_HOURS_REQUIRES_21_UNIQUE_RULES';
  end if;

  delete from public.booking_service_hours where client_id = p_client_id;

  insert into public.booking_service_hours(client_id, weekday, service, enabled, start_time, end_time)
  select p_client_id, rules.weekday, rules.service, rules.enabled, rules.start_time, rules.end_time
  from jsonb_to_recordset(p_rules) as rules(
    weekday smallint,
    service text,
    enabled boolean,
    start_time time,
    end_time time
  );
end;
$$;

revoke all on function public.replace_booking_service_hours(text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_booking_service_hours(text, jsonb) to service_role;

commit;
