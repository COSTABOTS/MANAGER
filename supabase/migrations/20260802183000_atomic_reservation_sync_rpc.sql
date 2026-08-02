begin;

alter table public.reservation_sync_runs
  add column request_id uuid;

alter table public.reservation_sync_runs
  add constraint reservation_sync_runs_client_request_key
  unique (client_id, request_id);

create function public.apply_reservation_sync_plan(
  p_client_id text,
  p_request_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_run public.reservation_sync_runs%rowtype;
  v_row_count integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_error_code text := 'ATOMIC_SYNC_FAILED';
  v_safe_error text;
begin
  if nullif(btrim(p_client_id), '') is null then
    raise exception using errcode = 'P0001', message = 'CLIENT_ID_REQUIRED';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'REQUEST_ID_REQUIRED';
  end if;
  if not exists (
    select 1 from public."CLIENTES" where client_id = p_client_id
  ) then
    raise exception using errcode = 'P0001', message = 'TENANT_NOT_FOUND';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_client_id, 240203)) then
    raise exception using errcode = 'P0001', message = 'SYNC_ALREADY_RUNNING';
  end if;

  select *
    into v_run
  from public.reservation_sync_runs
  where client_id = p_client_id
    and request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'run_id', v_run.id,
      'status', v_run.status,
      'inserted', 0,
      'updated', 0,
      'skipped', v_run.inserts + v_run.updates + v_run.skips,
      'deleted', 0,
      'errors', v_run.errors,
      'error_code', case
        when v_run.errors > 0 then v_run.error_summary #>> '{0,code}'
        else null
      end,
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1
    from public.reservation_sync_runs
    where client_id = p_client_id and status = 'running'
  ) then
    raise exception using errcode = 'P0001', message = 'SYNC_ALREADY_RUNNING';
  end if;

  insert into public.reservation_sync_runs (client_id, request_id)
  values (p_client_id, p_request_id)
  returning * into v_run;

  begin
    v_error_code := 'INVALID_PLAN_JSON';
    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_row_count := jsonb_array_length(p_rows);
    v_error_code := 'SYNC_ROW_LIMIT_EXCEEDED';
    if v_row_count > 500 then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'INVALID_PLAN_ROW';
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where jsonb_typeof(item) <> 'object'
        or coalesce(jsonb_typeof(item -> 'legacy_reservation_id'), 'null') <> 'string'
        or nullif(btrim(item ->> 'legacy_reservation_id'), '') is null
        or coalesce(jsonb_typeof(item -> 'booking_date'), 'null') <> 'string'
        or (item ->> 'booking_date') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(jsonb_typeof(item -> 'booking_time'), 'null') not in ('string', 'null')
        or (
          item ->> 'booking_time' is not null
          and item ->> 'booking_time' !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
        )
        or coalesce(jsonb_typeof(item -> 'service'), 'null') <> 'string'
        or nullif(btrim(item ->> 'service'), '') is null
        or coalesce(jsonb_typeof(item -> 'pax'), 'null') <> 'number'
        or (item ->> 'pax') !~ '^\d+$'
        or coalesce(jsonb_typeof(item -> 'status'), 'null') <> 'string'
        or coalesce(jsonb_typeof(item -> 'arrived'), 'null') <> 'boolean'
        or coalesce(jsonb_typeof(item -> 'feedback_sent'), 'null') <> 'boolean'
        or coalesce(jsonb_typeof(item -> 'pre_dinner_sent'), 'null') <> 'boolean'
        or coalesce(jsonb_typeof(item -> 'table_id'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'resource_id'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'customer_name'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'customer_phone'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'locale'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'special_request'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'legacy_status'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'legacy_source'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'room'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'balinese_package'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'legacy_created_at'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'legacy_updated_at'), 'null') not in ('string', 'null')
        or coalesce(jsonb_typeof(item -> 'legacy_locale'), 'null') not in ('string', 'null')
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    create temporary table atomic_reservation_sync_plan (
      legacy_reservation_id text not null,
      booking_date date not null,
      booking_time time,
      service text not null,
      customer_name text,
      customer_phone text,
      pax smallint not null,
      locale text,
      special_request text,
      status text not null,
      legacy_status text,
      legacy_source text,
      table_id uuid,
      resource_id uuid,
      room text,
      arrived boolean not null,
      feedback_sent boolean not null,
      pre_dinner_sent boolean not null,
      balinese_package text,
      legacy_created_at text,
      legacy_updated_at text,
      legacy_locale text
    ) on commit drop;

    v_error_code := 'INVALID_PLAN_VALUE';
    insert into atomic_reservation_sync_plan
    select
      btrim(item ->> 'legacy_reservation_id'),
      (item ->> 'booking_date')::date,
      nullif(item ->> 'booking_time', '')::time,
      btrim(item ->> 'service'),
      item ->> 'customer_name',
      item ->> 'customer_phone',
      (item ->> 'pax')::smallint,
      item ->> 'locale',
      item ->> 'special_request',
      item ->> 'status',
      item ->> 'legacy_status',
      item ->> 'legacy_source',
      nullif(item ->> 'table_id', '')::uuid,
      nullif(item ->> 'resource_id', '')::uuid,
      item ->> 'room',
      (item ->> 'arrived')::boolean,
      (item ->> 'feedback_sent')::boolean,
      (item ->> 'pre_dinner_sent')::boolean,
      item ->> 'balinese_package',
      item ->> 'legacy_created_at',
      item ->> 'legacy_updated_at',
      item ->> 'legacy_locale'
    from jsonb_array_elements(p_rows) item;

    v_error_code := 'INVALID_BOOKING_DATE';
    if exists (
      select 1 from atomic_reservation_sync_plan
      where booking_date::text !~ '^\d{4}-\d{2}-\d{2}$'
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'INVALID_PAX';
    if exists (
      select 1 from atomic_reservation_sync_plan where pax <= 0
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'INVALID_STATUS';
    if exists (
      select 1 from atomic_reservation_sync_plan
      where status not in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'legacy_unknown')
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'DUPLICATE_LEGACY_RESERVATION_ID';
    if exists (
      select 1
      from atomic_reservation_sync_plan
      group by legacy_reservation_id
      having count(*) > 1
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'TABLE_REFERENCE_OUTSIDE_TENANT';
    if exists (
      select 1
      from atomic_reservation_sync_plan p
      where p.table_id is not null
        and not exists (
          select 1 from public.restaurant_tables t
          where t.client_id = p_client_id and t.id = p.table_id
        )
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'RESOURCE_REFERENCE_OUTSIDE_TENANT';
    if exists (
      select 1
      from atomic_reservation_sync_plan p
      where p.resource_id is not null
        and not exists (
          select 1 from public.reservable_resources r
          where r.client_id = p_client_id and r.id = p.resource_id
        )
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    perform 1
    from public.reservations r
    join atomic_reservation_sync_plan p
      on p.legacy_reservation_id = r.legacy_reservation_id
    where r.client_id = p_client_id
    for update of r;

    v_error_code := 'PROTECTED_SOURCE_CONFLICT';
    if exists (
      select 1
      from public.reservations r
      join atomic_reservation_sync_plan p
        on p.legacy_reservation_id = r.legacy_reservation_id
      where r.client_id = p_client_id
        and r.source_channel not in ('sheets', 'legacy_unknown')
    ) then
      raise exception using errcode = 'P0001', message = v_error_code;
    end if;

    v_error_code := 'ATOMIC_INSERT_FAILED';
    insert into public.reservations (
      client_id, legacy_reservation_id, public_reference,
      booking_date, booking_time, service,
      customer_name, customer_phone, pax, locale, special_request,
      status, legacy_status, source_channel, legacy_source,
      table_id, resource_id, room, arrived, feedback_sent, pre_dinner_sent,
      balinese_package, legacy_created_at, legacy_updated_at, legacy_locale
    )
    select
      p_client_id, p.legacy_reservation_id, p.legacy_reservation_id,
      p.booking_date, p.booking_time, p.service,
      p.customer_name, p.customer_phone, p.pax, p.locale, p.special_request,
      p.status, p.legacy_status, 'sheets', p.legacy_source,
      p.table_id, p.resource_id, p.room, p.arrived, p.feedback_sent, p.pre_dinner_sent,
      p.balinese_package, p.legacy_created_at, p.legacy_updated_at, p.legacy_locale
    from atomic_reservation_sync_plan p
    where not exists (
      select 1
      from public.reservations r
      where r.client_id = p_client_id
        and r.legacy_reservation_id = p.legacy_reservation_id
    );
    get diagnostics v_inserted = row_count;

    v_error_code := 'ATOMIC_UPDATE_FAILED';
    update public.reservations r
    set booking_date = p.booking_date,
        booking_time = p.booking_time,
        service = p.service,
        customer_name = p.customer_name,
        customer_phone = p.customer_phone,
        pax = p.pax,
        locale = p.locale,
        special_request = p.special_request,
        status = p.status,
        legacy_status = p.legacy_status,
        legacy_source = p.legacy_source,
        table_id = p.table_id,
        resource_id = p.resource_id,
        room = p.room,
        arrived = p.arrived,
        feedback_sent = p.feedback_sent,
        pre_dinner_sent = p.pre_dinner_sent,
        balinese_package = p.balinese_package,
        legacy_created_at = p.legacy_created_at,
        legacy_updated_at = p.legacy_updated_at,
        legacy_locale = p.legacy_locale
    from atomic_reservation_sync_plan p
    where r.client_id = p_client_id
      and r.legacy_reservation_id = p.legacy_reservation_id
      and r.source_channel in ('sheets', 'legacy_unknown')
      and row(
        r.booking_date, r.booking_time, r.service,
        r.customer_name, r.customer_phone, r.pax, r.locale, r.special_request,
        r.status, r.legacy_status, r.legacy_source, r.table_id, r.resource_id,
        r.room, r.arrived, r.feedback_sent, r.pre_dinner_sent,
        r.balinese_package, r.legacy_created_at, r.legacy_updated_at, r.legacy_locale
      ) is distinct from row(
        p.booking_date, p.booking_time, p.service,
        p.customer_name, p.customer_phone, p.pax, p.locale, p.special_request,
        p.status, p.legacy_status, p.legacy_source, p.table_id, p.resource_id,
        p.room, p.arrived, p.feedback_sent, p.pre_dinner_sent,
        p.balinese_package, p.legacy_created_at, p.legacy_updated_at, p.legacy_locale
      );
    get diagnostics v_updated = row_count;

    v_skipped := v_row_count - v_inserted - v_updated;

    update public.reservation_sync_runs
    set finished_at = now(),
        inserts = v_inserted,
        updates = v_updated,
        skips = v_skipped,
        errors = 0,
        status = 'completed',
        error_summary = '[]'::jsonb
    where id = v_run.id;

    return jsonb_build_object(
      'run_id', v_run.id,
      'status', 'completed',
      'inserted', v_inserted,
      'updated', v_updated,
      'skipped', v_skipped,
      'deleted', 0,
      'errors', 0,
      'error_code', null,
      'idempotent_replay', false
    );
  exception
    when others then
      v_safe_error := case
        when sqlstate = 'P0001' and sqlerrm in (
          'INVALID_PLAN_JSON',
          'SYNC_ROW_LIMIT_EXCEEDED',
          'INVALID_PLAN_ROW',
          'INVALID_PLAN_VALUE',
          'INVALID_BOOKING_DATE',
          'INVALID_PAX',
          'INVALID_STATUS',
          'DUPLICATE_LEGACY_RESERVATION_ID',
          'TABLE_REFERENCE_OUTSIDE_TENANT',
          'RESOURCE_REFERENCE_OUTSIDE_TENANT',
          'PROTECTED_SOURCE_CONFLICT'
        ) then sqlerrm
        when v_error_code in ('ATOMIC_INSERT_FAILED', 'ATOMIC_UPDATE_FAILED') then v_error_code
        else 'ATOMIC_SYNC_FAILED'
      end;

      update public.reservation_sync_runs
      set finished_at = now(),
          inserts = 0,
          updates = 0,
          skips = 0,
          errors = 1,
          status = 'failed',
          error_summary = jsonb_build_array(jsonb_build_object('code', v_safe_error))
      where id = v_run.id;

      return jsonb_build_object(
        'run_id', v_run.id,
        'status', 'failed',
        'inserted', 0,
        'updated', 0,
        'skipped', 0,
        'deleted', 0,
        'errors', 1,
        'error_code', v_safe_error,
        'idempotent_replay', false
      );
  end;
end
$function$;

revoke all on function public.apply_reservation_sync_plan(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_reservation_sync_plan(text, uuid, jsonb)
  to service_role;

commit;
