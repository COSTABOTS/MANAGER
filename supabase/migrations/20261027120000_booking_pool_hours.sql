begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Configuration only. Its presence never activates a booking restriction.
-- SERVICES_ENABLED remains the authority for whether Balinesa is offered.
create table if not exists public.booking_pool_hours (
  client_id text primary key references public."CLIENTES"(client_id) on update restrict on delete restrict,
  opening_time time without time zone not null,
  closing_time time without time zone not null,
  time_zone text not null default 'Europe/Madrid',
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_pool_hours_window_check check (
    opening_time < closing_time
    and date_part('second', opening_time) = 0
    and date_part('second', closing_time) = 0
  ),
  constraint booking_pool_hours_zone_check check (time_zone = 'Europe/Madrid')
);

alter table public.booking_pool_hours enable row level security;
revoke all on table public.booking_pool_hours from public, anon, authenticated;
grant select, insert, update on table public.booking_pool_hours to service_role;

create or replace function public.get_booking_pool_hours_snapshot(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.booking_pool_hours%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('booking_pool_hours|' || p_client_id, 0));
  select * into v_row from public.booking_pool_hours where client_id = p_client_id;
  if not found then
    return jsonb_build_object('configured', false, 'opening_time', null,
      'closing_time', null, 'time_zone', 'Europe/Madrid', 'revision', null);
  end if;
  return jsonb_build_object('configured', true,
    'opening_time', to_char(v_row.opening_time, 'HH24:MI'),
    'closing_time', to_char(v_row.closing_time, 'HH24:MI'),
    'time_zone', v_row.time_zone, 'revision', v_row.revision::text);
end;
$$;

create or replace function public.replace_booking_pool_hours(
  p_client_id text,
  p_opening_time text,
  p_closing_time text,
  p_expected_revision text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current_revision text;
  v_saved public.booking_pool_hours%rowtype;
begin
  if nullif(btrim(p_client_id), '') is null
     or p_opening_time is null or p_opening_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_closing_time is null or p_closing_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or p_opening_time >= p_closing_time
     or (p_expected_revision is not null
         and p_expected_revision !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode = 'P0001', message = 'POOL_HOURS_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('booking_pool_hours|' || p_client_id, 0));
  select revision::text into v_current_revision
    from public.booking_pool_hours where client_id = p_client_id;
  if v_current_revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'POOL_HOURS_CONFLICT';
  end if;

  insert into public.booking_pool_hours(client_id, opening_time, closing_time, time_zone)
    values (p_client_id, p_opening_time::time, p_closing_time::time, 'Europe/Madrid')
  on conflict (client_id) do update set
    opening_time = excluded.opening_time,
    closing_time = excluded.closing_time,
    time_zone = excluded.time_zone,
    revision = gen_random_uuid(),
    updated_at = now();

  select * into v_saved from public.booking_pool_hours where client_id = p_client_id;
  return jsonb_build_object('configured', true,
    'opening_time', to_char(v_saved.opening_time, 'HH24:MI'),
    'closing_time', to_char(v_saved.closing_time, 'HH24:MI'),
    'time_zone', v_saved.time_zone, 'revision', v_saved.revision::text);
end;
$$;

revoke all on function public.get_booking_pool_hours_snapshot(text) from public, anon, authenticated;
grant execute on function public.get_booking_pool_hours_snapshot(text) to service_role;
revoke all on function public.replace_booking_pool_hours(text,text,text,text) from public, anon, authenticated;
grant execute on function public.replace_booking_pool_hours(text,text,text,text) to service_role;

commit;
