begin;

-- Extend internal WEEKLY walk-in admission only; keep public booking hours unchanged.
create or replace function public.hospitality_weekly_walkin_capacity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $walkin$
declare
  v_true integer; v_false integer; v_invalid integer;
  v_settings_count integer; v_value text; v_services text[];
  v_rule_count integer; v_distinct_count integer; v_invalid_count integer;
  v_start time; v_end time; v_open boolean;
  v_interval integer; v_start_min integer; v_end_min integer; v_arrival_min integer;
  v_arrival_seconds integer; v_slot_min integer; v_last_slot_min integer;
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
  v_end_min := extract(hour from v_end)::integer*60 + extract(minute from v_end)::integer;
  v_arrival_min := extract(hour from new.booking_time)::integer*60 + extract(minute from new.booking_time)::integer;
  v_arrival_seconds := floor(extract(epoch from new.booking_time))::integer;
  if (new.source_channel = 'walk_in' and
      (v_arrival_seconds < greatest(0,v_start_min-30)*60
       or v_arrival_seconds > least(1440,v_end_min+30)*60))
     or (new.source_channel = 'manager_manual' and
      (new.booking_time < v_start or new.booking_time >= v_end)) then
    raise exception using errcode='P0001', message=case when new.source_channel='walk_in'
      then 'WALKIN_OUTSIDE_WEEKLY_HOURS' else 'RESERVATION_OUTSIDE_WEEKLY_HOURS' end;
  end if;

  -- If this service is only in its margin, an actually open service wins.
  if new.source_channel = 'walk_in' and
     (new.booking_time < v_start or new.booking_time >= v_end) then
    select h.service,h.start_time,h.end_time into v_service,v_start,v_end
      from public.booking_service_hours h
      where h.client_id=new.client_id and h.weekday=extract(dow from new.booking_date)::integer
        and h.enabled and h.service=any(v_services)
        and new.booking_time>=h.start_time and new.booking_time<h.end_time
      order by array_position(array['DESAYUNO','ALMUERZO','CENA'],h.service)
      limit 1;
    if found then
      v_start_min := extract(hour from v_start)::integer*60 + extract(minute from v_start)::integer;
      v_end_min := extract(hour from v_end)::integer*60 + extract(minute from v_end)::integer;
    else
      v_service := upper(new.service);
    end if;
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
  v_last_slot_min := v_start_min + (v_end_min-v_start_min-1)/v_interval*v_interval;
  v_slot_min := least(v_last_slot_min,
    v_start_min + greatest(0,(v_arrival_min-v_start_min)/v_interval)*v_interval);
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

commit;
