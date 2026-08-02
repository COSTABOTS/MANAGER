begin;

create function public.create_hospitality_reservation(
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

  perform pg_advisory_xact_lock(hashtextextended(p_client_id||'|'||v_date||'|'||v_time||'|'||v_service,240204));
  select * into v_existing from public.booking_idempotency
   where client_id=p_client_id and operation='reservation.create' and idempotency_key=p_idempotency_key;
  if found and v_existing.status='succeeded' then
    return jsonb_build_object('reservation_id',v_existing.reservation_id,'idempotent_replay',true);
  elsif found then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT';
  end if;

  if exists(select 1 from public.booking_day_controls where client_id=p_client_id and booking_date=v_date
    and (service is null or upper(service)=v_service) and (status='closed' or fully_booked)) then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
  end if;
  select coalesce(max(capacity),0) into v_capacity from public.booking_capacity_slots
   where client_id=p_client_id and active=true and slot_time=v_time
     and (service is null or upper(service)=v_service)
     and (weekday is null or weekday=extract(isodow from v_date)::integer)
     and (valid_from is null or valid_from<=v_date) and (valid_until is null or valid_until>=v_date);
  select max(capacity_override) into v_override from public.booking_day_controls
   where client_id=p_client_id and booking_date=v_date and (service is null or upper(service)=v_service);
  select coalesce(sum(capacity_reduction),0) into v_reduction from public.booking_blocks
   where client_id=p_client_id and booking_date=v_date and active=true
     and (service is null or upper(service)=v_service)
     and (starts_at is null or starts_at<=v_time) and (ends_at is null or ends_at>v_time);
  v_capacity := greatest(0,coalesce(v_override,v_capacity)-v_reduction);
  select coalesce(sum(pax),0) into v_reserved from public.reservations
   where client_id=p_client_id and booking_date=v_date and booking_time=v_time and upper(service)=v_service
     and (status in ('confirmed','pending') or legacy_status in ('CONFIRMADA','CONFIRMED'))
     and status not in ('cancelled','no_show');
  if v_capacity=0 or v_reserved+v_pax>v_capacity then
    raise exception using errcode='P0001', message='AVAILABILITY_EXHAUSTED';
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
