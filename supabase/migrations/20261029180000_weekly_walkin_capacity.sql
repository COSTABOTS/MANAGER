begin;

-- booking_time remains the actual arrival time. This nullable attribution is
-- populated for internal restaurant reservations of tenants with WEEKLY_HOURS_ENABLED=true.
alter table public.reservations add column if not exists capacity_slot_time time;
create index if not exists ix_reservations_capacity_slot
  on public.reservations(client_id, service, booking_date, capacity_slot_time, status)
  where capacity_slot_time is not null;

-- The database clock, never an HTTP payload, supplies the actual walk-in arrival.
create or replace function public.hospitality_weekly_walkin_clock()
returns timestamptz language sql volatile security invoker
set search_path = pg_catalog
as $$ select clock_timestamp() $$;
revoke all on function public.hospitality_weekly_walkin_clock() from public, anon, authenticated, service_role;

create or replace function public.hospitality_weekly_walkin_capacity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $walkin$
declare
  v_true integer; v_false integer; v_invalid integer;
  v_settings_count integer; v_value text; v_services text[];
  v_rule_count integer; v_distinct_count integer; v_invalid_count integer;
  v_start time; v_end time; v_open boolean;
  v_interval integer; v_start_min integer; v_arrival_min integer; v_slot_min integer;
  v_slot time; v_slot_count integer; v_capacity integer; v_override integer; v_reduction integer; v_reserved integer;
  v_service text; v_now timestamp;
begin
  if (new.source_channel is distinct from 'walk_in' and new.source_channel is distinct from 'manager_manual')
     or upper(new.service) = 'BALINESA' then return new; end if;
  -- The same tenant lock is taken by schedule replacement and controlled activation.
  -- Read the mode only after acquiring it, so a concurrent activation cannot be missed.
  perform pg_advisory_xact_lock_shared(hashtextextended(new.client_id,0));
  -- Missing/false keeps legacy inserts byte-for-byte compatible.
  begin
    with flags as (
      select lower(btrim(coalesce("VALOR"::text,''))) as value from public."SETTINGS"
      where "CLIENTE_ID"=new.client_id and "CLAVE"='WEEKLY_HOURS_ENABLED'
    ) select count(*) filter (where value in ('true','1','yes','on')),
             count(*) filter (where value in ('false','0','no','off','')),
             count(*) filter (where value not in ('true','1','yes','on','false','0','no','off',''))
      into v_true,v_false,v_invalid from flags;
  exception when others then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
  end;
  if v_invalid > 0 or v_true + v_false + v_invalid > 1 then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
  end if;
  if v_true = 0 then return new; end if;

  if new.source_channel = 'walk_in' then
    v_now := public.hospitality_weekly_walkin_clock() at time zone 'Europe/Madrid';
    new.booking_date := v_now::date;
    new.booking_time := v_now::time;
  end if;
  v_service := upper(new.service);
  if v_service not in ('DESAYUNO','ALMUERZO','CENA') or new.booking_time is null then
    raise exception using errcode='P0001', message='SERVICE_NOT_ENABLED';
  end if;
  begin
    select count(*),max("VALOR"::text) into v_settings_count,v_value from public."SETTINGS"
      where "CLIENTE_ID"=new.client_id and "CLAVE"='SERVICES_ENABLED';
  exception when others then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
  end;
  if v_settings_count > 1 then raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID'; end if;
  if btrim(coalesce(v_value,'')) = '' then
    v_services := array['CENA']::text[];
  else
    select coalesce(array_agg(distinct btrim(token)) filter
      (where btrim(token) in ('DESAYUNO','ALMUERZO','CENA')),array[]::text[])
      into v_services from regexp_split_to_table(upper(v_value),'[,;[:space:]]+') as parts(token);
  end if;
  if not v_service = any(v_services) then
    raise exception using errcode='P0001', message='SERVICE_NOT_ENABLED';
  end if;

  begin
    select count(*),count(distinct (weekday,service)),
      count(*) filter (where weekday not between 0 and 6 or service not in ('DESAYUNO','ALMUERZO','CENA')
        or (enabled and (start_time is null or end_time is null or start_time >= end_time
          or extract(second from start_time) <> 0 or extract(second from end_time) <> 0))
        or (not enabled and (start_time is not null or end_time is not null)))
      into v_rule_count,v_distinct_count,v_invalid_count
      from public.booking_service_hours where client_id=new.client_id;
  exception when others then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
  end;
  if v_rule_count <> 21 or v_distinct_count <> 21 or v_invalid_count <> 0 then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
  end if;
  select enabled,start_time,end_time into v_open,v_start,v_end
    from public.booking_service_hours where client_id=new.client_id
      and weekday=extract(dow from new.booking_date)::integer and service=v_service;
  if not found or not v_open then
    raise exception using errcode='P0001', message=case when new.source_channel='walk_in'
      then 'WALKIN_OUTSIDE_WEEKLY_HOURS' else 'RESERVATION_OUTSIDE_WEEKLY_HOURS' end;
  end if;
  v_start_min := extract(hour from v_start)::integer*60 + extract(minute from v_start)::integer;
  v_arrival_min := extract(hour from new.booking_time)::integer*60 + extract(minute from new.booking_time)::integer;
  if v_arrival_min < v_start_min or new.booking_time >= v_end then
    raise exception using errcode='P0001', message=case when new.source_channel='walk_in'
      then 'WALKIN_OUTSIDE_WEEKLY_HOURS' else 'RESERVATION_OUTSIDE_WEEKLY_HOURS' end;
  end if;

  begin
    select count(*),max("VALOR"::text) into v_settings_count,v_value from public."SETTINGS"
      where "CLIENTE_ID"=new.client_id and "CLAVE"='BOOKING_INTERVAL';
  exception when others then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
  end;
  if v_settings_count <> 1 or btrim(coalesce(v_value,'')) not in ('30','60') then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
  end if;
  v_interval := v_value::integer;
  v_slot_min := v_start_min + greatest(0,(v_arrival_min-v_start_min)/v_interval)*v_interval;
  v_slot := make_time(v_slot_min/60,v_slot_min%60,0);
  -- Same tenant/slot lock key as the public reservation RPC.
  perform pg_advisory_xact_lock(hashtextextended(
    new.client_id||'|'||new.booking_date||'|'||v_slot||'|'||v_service,240204));
  select count(*),coalesce(max(capacity),0) into v_slot_count,v_capacity from public.booking_capacity_slots
    where client_id=new.client_id and active=true and slot_time=v_slot
      and (service is null or upper(service)=v_service)
      and (weekday is null or weekday=extract(dow from new.booking_date)::integer)
      and (valid_from is null or valid_from<=new.booking_date)
      and (valid_until is null or valid_until>=new.booking_date);
  -- An actual slot must exist; an override alone must not invent a booking hour.
  if v_slot_count=0 then raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED'; end if;
  if exists(select 1 from public.booking_day_controls where client_id=new.client_id
    and booking_date=new.booking_date and (service is null or upper(service)=v_service)
    and (status='closed' or fully_booked)) then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
  end if;
  select max(capacity_override) into v_override from public.booking_day_controls
    where client_id=new.client_id and booking_date=new.booking_date
      and (service is null or upper(service)=v_service);
  select coalesce(sum(capacity_reduction),0) into v_reduction from public.booking_blocks
    where client_id=new.client_id and booking_date=new.booking_date and active=true
      and (service is null or upper(service)=v_service)
      and (starts_at is null or starts_at<=v_slot) and (ends_at is null or ends_at>v_slot);
  v_capacity := greatest(0,coalesce(v_override,v_capacity)-v_reduction);
  select coalesce(sum(pax),0) into v_reserved from public.reservations
    where client_id=new.client_id and booking_date=new.booking_date
      and coalesce(capacity_slot_time,booking_time)=v_slot and upper(service)=v_service
      and (status in ('confirmed','pending') or legacy_status in ('CONFIRMADA','CONFIRMED'))
      and status not in ('cancelled','no_show');
  if v_capacity=0 or v_reserved+new.pax>v_capacity then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
  end if;
  new.service := v_service;
  new.capacity_slot_time := v_slot;
  return new;
end
$walkin$;
revoke all on function public.hospitality_weekly_walkin_capacity() from public, anon, authenticated, service_role;
drop trigger if exists hospitality_weekly_walkin_capacity on public.reservations;
create trigger hospitality_weekly_walkin_capacity before insert on public.reservations
  for each row execute function public.hospitality_weekly_walkin_capacity();

-- This no-argument clock cannot be influenced by reservation payloads or session GUCs.
-- Disposable SQL tests may replace its body; production always uses clock_timestamp().
create or replace function public.hospitality_weekly_reservation_clock()
returns timestamptz
language sql volatile security invoker
set search_path = pg_catalog
as $$ select clock_timestamp() $$;
revoke all on function public.hospitality_weekly_reservation_clock() from public, anon, authenticated, service_role;

-- A local time must round-trip uniquely through Europe/Madrid before comparison.
-- Checking both sides of PostgreSQL's chosen candidate rejects CET/CEST folds and gaps.
create or replace function public.hospitality_weekly_reservation_time_eligible(
  p_date date, p_time time, p_now timestamptz
) returns boolean
language plpgsql stable security invoker
set search_path = pg_catalog
as $time_function$
declare
  v_local timestamp; v_instant timestamptz; v_offset integer;
begin
  if p_date is null or p_time is null or p_now is null then return false; end if;
  v_local := p_date + p_time;
  v_instant := v_local at time zone 'Europe/Madrid';
  if (v_instant at time zone 'Europe/Madrid') <> v_local then return false; end if;
  for v_offset in -2..2 loop
    if v_offset <> 0 and
       ((v_instant + v_offset * interval '1 hour') at time zone 'Europe/Madrid') = v_local then
      return false;
    end if;
  end loop;
  return v_instant >= p_now + interval '30 minutes';
end
$time_function$;
revoke all on function public.hospitality_weekly_reservation_time_eligible(date,time,timestamptz)
  from public, anon, authenticated, service_role;

-- The existing public RPC is redefined below with one capacity-count change:
-- coalesce(capacity_slot_time,booking_time)=v_time. Its other behavior is preserved.
create or replace function public.create_hospitality_reservation(
  p_client_id text,
  p_idempotency_key text,
  p_reservation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_date date; v_time time; v_service text; v_pax integer; v_capacity integer;
  v_reserved integer; v_override integer; v_reduction integer; v_id uuid; v_existing public.booking_idempotency%rowtype;
  v_flag_true integer; v_flag_false integer; v_flag_invalid integer; v_weekly_enabled boolean;
  v_setting_count integer; v_setting_value text; v_services text[];
  v_rule_count integer; v_distinct_count integer; v_invalid_count integer;
  v_rule_enabled boolean; v_rule_start time; v_rule_end time;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_idempotency_key),'') is null
     or jsonb_typeof(p_reservation) <> 'object' then
    raise exception using errcode='P0001', message='INVALID_REQUEST';
  end if;
  if not exists(select 1 from public."CLIENTES" where client_id=p_client_id) then
    raise exception using errcode='P0001', message='INVALID_CLIENT';
  end if;
  v_date := (p_reservation->>'booking_date')::date;
  v_time := (p_reservation->>'booking_time')::time;
  v_service := upper(coalesce(nullif(p_reservation->>'service',''),'CENA'));
  v_pax := (p_reservation->>'pax')::integer;
  if v_pax <= 0 then raise exception using errcode='P0001', message='INVALID_PAX'; end if;

  -- Shared for concurrent reservations; exclusive in replace_booking_service_hours.
  -- Always acquire tenant before slot so both operations have a stable lock order.
  perform pg_advisory_xact_lock_shared(hashtextextended(p_client_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_client_id||'|'||v_date||'|'||v_time||'|'||v_service,240204));
  select * into v_existing from public.booking_idempotency
   where client_id=p_client_id and operation='reservation.create' and idempotency_key=p_idempotency_key;
  if found and v_existing.status='succeeded' then
    return jsonb_build_object('reservation_id',v_existing.reservation_id,'idempotent_replay',true);
  elsif found then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT';
  end if;

  -- Missing/false is legacy. A malformed or contradictory flag fails closed.
  begin
    with flags as (
      select lower(btrim(coalesce("VALOR"::text,''))) as value
      from public."SETTINGS"
      where "CLIENTE_ID"=p_client_id and "CLAVE"='WEEKLY_HOURS_ENABLED'
    )
    select count(*) filter (where value in ('true','1','yes','on')),
           count(*) filter (where value in ('false','0','no','off','')),
           count(*) filter (where value not in ('true','1','yes','on','false','0','no','off',''))
      into v_flag_true, v_flag_false, v_flag_invalid
    from flags;
  exception when others then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
  end;
  if v_flag_invalid > 0 or v_flag_true + v_flag_false + v_flag_invalid > 1 then
    raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
  end if;
  v_weekly_enabled := v_flag_true > 0;

  if v_weekly_enabled then
    if v_service not in ('DESAYUNO','ALMUERZO','CENA') then
      raise exception using errcode='P0001', message='SERVICE_NOT_ENABLED';
    end if;

    begin
      select count(*), max("VALOR"::text) into v_setting_count, v_setting_value
      from public."SETTINGS"
      where "CLIENTE_ID"=p_client_id and "CLAVE"='BOOKINGS_ENABLED';
    exception when others then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
    end;
    if v_setting_count > 1 then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
    end if;
    if lower(btrim(coalesce(v_setting_value,''))) in ('false','0','no','off','disabled') then
      raise exception using errcode='P0001', message='BOOKINGS_DISABLED';
    end if;

    begin
      select count(*), max("VALOR"::text) into v_setting_count, v_setting_value
      from public."SETTINGS"
      where "CLIENTE_ID"=p_client_id and "CLAVE"='SERVICES_ENABLED';
    exception when others then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
    end;
    if v_setting_count > 1 then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
    end if;
    if btrim(coalesce(v_setting_value,'')) = '' then
      v_services := array['CENA']::text[];
    else
      select coalesce(
        array_agg(distinct btrim(token)) filter (where btrim(token) in ('DESAYUNO','ALMUERZO','CENA')),
        array[]::text[]
      ) into v_services
      from regexp_split_to_table(upper(v_setting_value), '[,;[:space:]]+') as parts(token);
    end if;
    if not v_service = any(v_services) then
      raise exception using errcode='P0001', message='SERVICE_NOT_ENABLED';
    end if;

    begin
      select count(*), count(distinct (weekday,service)),
             count(*) filter (where weekday not between 0 and 6
               or service not in ('DESAYUNO','ALMUERZO','CENA')
               or (enabled and (start_time is null or end_time is null or start_time >= end_time
                 or extract(second from start_time) <> 0 or extract(second from end_time) <> 0))
               or (not enabled and (start_time is not null or end_time is not null)))
        into v_rule_count, v_distinct_count, v_invalid_count
      from public.booking_service_hours
      where client_id=p_client_id;
    exception when others then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_READ_FAILED';
    end;
    if v_rule_count <> 21 or v_distinct_count <> 21 or v_invalid_count <> 0 then
      raise exception using errcode='P0001', message='WEEKLY_HOURS_CONFIG_INVALID';
    end if;

    select enabled, start_time, end_time
      into v_rule_enabled, v_rule_start, v_rule_end
    from public.booking_service_hours
    where client_id=p_client_id
      and weekday=extract(dow from v_date)::integer
      and service=v_service;
    if not found or not v_rule_enabled or v_time < v_rule_start or v_time >= v_rule_end then
      raise exception using errcode='P0001', message='RESERVATION_OUTSIDE_WEEKLY_HOURS';
    end if;
  end if;

  if exists(select 1 from public.booking_day_controls where client_id=p_client_id and booking_date=v_date
    and (service is null or upper(service)=v_service) and (status='closed' or fully_booked)) then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
  end if;
  select coalesce(max(capacity),0) into v_capacity from public.booking_capacity_slots
   where client_id=p_client_id and active=true and slot_time=v_time
     and (service is null or upper(service)=v_service)
     and (weekday is null or weekday=case when v_weekly_enabled
       then extract(dow from v_date)::integer else extract(isodow from v_date)::integer end)
     and (valid_from is null or valid_from<=v_date) and (valid_until is null or valid_until>=v_date);
  select max(capacity_override) into v_override from public.booking_day_controls
   where client_id=p_client_id and booking_date=v_date and (service is null or upper(service)=v_service);
  select coalesce(sum(capacity_reduction),0) into v_reduction from public.booking_blocks
   where client_id=p_client_id and booking_date=v_date and active=true
     and (service is null or upper(service)=v_service)
     and (starts_at is null or starts_at<=v_time) and (ends_at is null or ends_at>v_time);
  v_capacity := greatest(0,coalesce(v_override,v_capacity)-v_reduction);
  select coalesce(sum(pax),0) into v_reserved from public.reservations
   where client_id=p_client_id and booking_date=v_date and coalesce(capacity_slot_time,booking_time)=v_time and upper(service)=v_service
     and (status in ('confirmed','pending') or legacy_status in ('CONFIRMADA','CONFIRMED'))
     and status not in ('cancelled','no_show');
  if v_capacity=0 or v_reserved+v_pax>v_capacity then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
  end if;

  -- Recheck at the final write boundary. Legacy tenants do not enter this branch.
  -- Successful idempotent replays returned above remain valid after the slot passes.
  if v_weekly_enabled and not public.hospitality_weekly_reservation_time_eligible(
    v_date, v_time, public.hospitality_weekly_reservation_clock()
  ) then
    raise exception using errcode='P0001', message='RESERVATION_TIME_PASSED';
  end if;

  insert into public.booking_idempotency(client_id,idempotency_key,operation,request_hash,status,expires_at)
  values(p_client_id,p_idempotency_key,'reservation.create',md5(p_reservation::text),'processing',now()+interval '24 hours');
  insert into public.reservations(client_id,legacy_reservation_id,public_reference,booking_date,booking_time,service,
    customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,
    legacy_source,table_id,room,arrived,feedback_sent,balinese_package,legacy_created_at,legacy_updated_at)
  values(p_client_id,p_reservation->>'legacy_reservation_id',p_reservation->>'public_reference',v_date,v_time,v_service,
    nullif(p_reservation->>'customer_name',''),nullif(p_reservation->>'customer_phone',''),v_pax,
    nullif(p_reservation->>'locale',''),nullif(p_reservation->>'legacy_locale',''),nullif(p_reservation->>'special_request',''),
    coalesce(p_reservation->>'status','confirmed'),p_reservation->>'legacy_status','typebot',p_reservation->>'legacy_source',
    nullif(p_reservation->>'table_id','')::uuid,nullif(p_reservation->>'room',''),coalesce((p_reservation->>'arrived')::boolean,false),
    coalesce((p_reservation->>'feedback_sent')::boolean,false),nullif(p_reservation->>'balinese_package',''),
    p_reservation->>'legacy_created_at',p_reservation->>'legacy_updated_at') returning id into v_id;
  update public.booking_idempotency set reservation_id=v_id,status='succeeded',response_code='CREATED'
   where client_id=p_client_id and operation='reservation.create' and idempotency_key=p_idempotency_key;
  return jsonb_build_object('reservation_id',v_id,'idempotent_replay',false);
end
$function$;

revoke all on function public.create_hospitality_reservation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_hospitality_reservation(text,text,jsonb) to service_role;

commit;
