begin;

create function public.create_hospitality_balinese_reservation(
  p_client_id text,
  p_idempotency_key text,
  p_reservation jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $function$
declare
  v_date date;
  v_time time;
  v_pax integer;
  v_resource public.reservable_resources%rowtype;
  v_id uuid;
  v_existing public.booking_idempotency%rowtype;
begin
  if nullif(btrim(p_client_id),'') is null or nullif(btrim(p_idempotency_key),'') is null
     or jsonb_typeof(p_reservation) <> 'object' then
    raise exception using errcode='P0001', message='INVALID_REQUEST';
  end if;
  if not exists (select 1 from public."CLIENTES" where client_id=p_client_id) then
    raise exception using errcode='P0001', message='INVALID_CLIENT';
  end if;
  v_date := (p_reservation->>'booking_date')::date;
  v_time := nullif(p_reservation->>'booking_time','')::time;
  v_pax := (p_reservation->>'pax')::integer;
  if upper(coalesce(p_reservation->>'service','')) <> 'BALINESA' then
    raise exception using errcode='P0001', message='INVALID_SERVICE';
  end if;
  if v_pax is null or v_pax <= 0 then
    raise exception using errcode='P0001', message='INVALID_PAX';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_id||'|'||v_date,240204));
  select * into v_existing from public.booking_idempotency
    where client_id=p_client_id and operation='reservation.balinese.create' and idempotency_key=p_idempotency_key;
  if found and v_existing.status='succeeded' then
    select rr.* into v_resource from public.reservable_resources rr
      join public.reservations rv on rv.resource_id=rr.id and rv.client_id=rr.client_id
      where rv.client_id=p_client_id and rv.id=v_existing.reservation_id;
    return jsonb_build_object('reservation_id',v_existing.reservation_id,'resource_id',v_resource.id,'resource_label',v_resource.label,'idempotent_replay',true);
  elsif found then
    raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT';
  end if;

  select r.* into v_resource
    from public.reservable_resources r
    where r.client_id=p_client_id and r.active=true and r.capacity>=v_pax
      and not exists (
        select 1 from public.reservations x
        where x.client_id=p_client_id and x.booking_date=v_date and x.resource_id=r.id
          and upper(x.service)='BALINESA'
          and (x.status in ('confirmed','pending') or x.legacy_status in ('CONFIRMADA','CONFIRMED'))
          and x.status not in ('cancelled','no_show')
      )
    order by r.display_order, r.id
    limit 1;
  if not found then
    if exists (select 1 from public.reservable_resources r where r.client_id=p_client_id and r.active=true and r.capacity>=v_pax) then
      raise exception using errcode='P0001', message='NO_RESOURCE_AVAILABLE';
    end if;
    raise exception using errcode='P0001', message='NO_RESOURCE_WITH_CAPACITY';
  end if;

  insert into public.booking_idempotency(client_id,idempotency_key,operation,request_hash,status,expires_at)
    values(p_client_id,p_idempotency_key,'reservation.balinese.create',md5(p_reservation::text),'processing',now()+interval '24 hours');
  insert into public.reservations(client_id,legacy_reservation_id,public_reference,booking_date,booking_time,service,
    customer_name,customer_phone,pax,locale,legacy_locale,special_request,status,legacy_status,source_channel,
    legacy_source,resource_id,room,arrived,feedback_sent,balinese_package)
  values(p_client_id,p_reservation->>'legacy_reservation_id',p_reservation->>'public_reference',v_date,v_time,'BALINESA',
    nullif(p_reservation->>'customer_name',''),nullif(p_reservation->>'customer_phone',''),v_pax,
    nullif(p_reservation->>'locale',''),nullif(p_reservation->>'legacy_locale',''),nullif(p_reservation->>'special_request',''),
    case upper(coalesce(p_reservation->>'status','CONFIRMADA')) when 'PENDIENTE' then 'pending' when 'PENDING' then 'pending' when 'CANCELADA' then 'cancelled' when 'CANCELLED' then 'cancelled' else 'confirmed' end,
    coalesce(p_reservation->>'legacy_status',p_reservation->>'status'),'typebot',p_reservation->>'legacy_source',
    v_resource.id,nullif(p_reservation->>'room',''),coalesce((p_reservation->>'arrived')::boolean,false),
    coalesce((p_reservation->>'feedback_sent')::boolean,false),nullif(p_reservation->>'balinese_package',''))
    returning id into v_id;
  update public.booking_idempotency set reservation_id=v_id,status='succeeded',response_code='CREATED'
    where client_id=p_client_id and operation='reservation.balinese.create' and idempotency_key=p_idempotency_key;
  return jsonb_build_object('reservation_id',v_id,'resource_id',v_resource.id,'resource_label',v_resource.label,'idempotent_replay',false);
end
$function$;

revoke all on function public.create_hospitality_balinese_reservation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_hospitality_balinese_reservation(text,text,jsonb) to service_role;
commit;
