-- COSTABOTS Hospitality — canonical Phase 1 schema.
-- This migration represents the schema already applied to production.
-- On that existing database, record it with migration repair; do not execute it again.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  unexpected text[];
begin
  if to_regclass('public."CLIENTES"') is null or to_regclass('public."PROFILES"') is null then
    raise exception 'BASELINE_MISMATCH: CLIENTES or PROFILES missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='CLIENTES' and column_name='client_id' and data_type='text' and is_nullable='YES') then
    raise exception 'BASELINE_MISMATCH: CLIENTES.client_id must be nullable text before Phase 1';
  end if;
  if exists (select 1 from public."CLIENTES" where client_id is null or btrim(client_id)='') then
    raise exception 'PRECHECK_FAILED: null or blank CLIENTES.client_id';
  end if;
  if exists (select 1 from public."CLIENTES" group by client_id having count(*) > 1) then
    raise exception 'PRECHECK_FAILED: duplicate CLIENTES.client_id';
  end if;
  if exists (select 1 from pg_constraint where conrelid='public."CLIENTES"'::regclass and contype='u' and pg_get_constraintdef(oid) like 'UNIQUE (client_id)%') then
    raise exception 'BASELINE_MISMATCH: CLIENTES.client_id is already unique';
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'BASELINE_MISMATCH: gen_random_uuid() unavailable';
  end if;
  if to_regprocedure('public.hospitality_set_updated_at()') is not null then
    raise exception 'BASELINE_MISMATCH: hospitality_set_updated_at already exists';
  end if;
  select array_agg(name order by name) into unexpected
  from unnest(array[
    'restaurant_customers','restaurant_tables','reservable_resources',
    'booking_capacity_slots','booking_day_controls','booking_blocks',
    'reservations','feedbacks','booking_idempotency'
  ]) name
  where to_regclass('public.'||quote_ident(name)) is not null;
  if unexpected is not null then
    raise exception 'BASELINE_MISMATCH: Phase 1 objects already exist: %', unexpected;
  end if;
end $$;

alter table public."CLIENTES" alter column client_id set not null;
alter table public."CLIENTES" add constraint clientes_client_id_key unique (client_id);
alter table public."CLIENTES"
  add column timezone text not null default 'Europe/Madrid',
  add column reservation_store text not null default 'sheets',
  add column reservation_shadow_read boolean not null default false,
  add constraint clientes_reservation_store_check check (reservation_store in ('sheets','supabase'));

create table public.restaurant_customers (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  name text, phone text, phone_normalized text, email text, email_normalized text,
  locale text, notes text, legacy_customer_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint restaurant_customers_client_id_id_key unique (client_id,id)
);
create unique index uq_restaurant_customers_phone on public.restaurant_customers(client_id,phone_normalized) where nullif(phone_normalized,'') is not null;
create unique index uq_restaurant_customers_email on public.restaurant_customers(client_id,email_normalized) where nullif(email_normalized,'') is not null;
create unique index uq_restaurant_customers_legacy on public.restaurant_customers(client_id,legacy_customer_id) where nullif(legacy_customer_id,'') is not null;
create index ix_restaurant_customers_name on public.restaurant_customers(client_id,name);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  legacy_table_id text, label text not null, zone text, capacity smallint not null,
  active boolean not null default true, display_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint restaurant_tables_capacity_check check (capacity > 0),
  constraint restaurant_tables_client_id_id_key unique (client_id,id)
);
create unique index uq_restaurant_tables_label on public.restaurant_tables(client_id,label);
create unique index uq_restaurant_tables_legacy on public.restaurant_tables(client_id,legacy_table_id) where nullif(legacy_table_id,'') is not null;
create index ix_restaurant_tables_active on public.restaurant_tables(client_id,active,display_order);

create table public.reservable_resources (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  legacy_resource_id text, resource_type text not null default 'balinese', label text not null,
  zone text, capacity smallint not null, active boolean not null default true,
  display_order integer not null default 0, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint reservable_resources_type_check check (resource_type='balinese'),
  constraint reservable_resources_capacity_check check (capacity > 0),
  constraint reservable_resources_client_id_id_key unique (client_id,id)
);
create unique index uq_reservable_resources_label on public.reservable_resources(client_id,resource_type,label);
create unique index uq_reservable_resources_legacy on public.reservable_resources(client_id,legacy_resource_id) where nullif(legacy_resource_id,'') is not null;
create index ix_reservable_resources_active on public.reservable_resources(client_id,resource_type,active,display_order);

create table public.booking_capacity_slots (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  service text, weekday smallint, slot_time time not null, capacity integer not null,
  active boolean not null default true, valid_from date, valid_until date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint booking_capacity_weekday_check check (weekday is null or weekday between 0 and 6),
  constraint booking_capacity_value_check check (capacity >= 0),
  constraint booking_capacity_dates_check check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create unique index uq_booking_capacity_rule on public.booking_capacity_slots(client_id,coalesce(service,''),coalesce(weekday,-1),slot_time,coalesce(valid_from,date '0001-01-01'));
create index ix_booking_capacity_lookup on public.booking_capacity_slots(client_id,service,active,slot_time);

create table public.booking_day_controls (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  service text, booking_date date not null, status text not null default 'open',
  fully_booked boolean not null default false, capacity_override integer, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint booking_day_controls_status_check check (status in ('open','closed')),
  constraint booking_day_controls_capacity_check check (capacity_override is null or capacity_override >= 0)
);
create unique index uq_booking_day_controls on public.booking_day_controls(client_id,coalesce(service,''),booking_date);
create index ix_booking_day_controls_lookup on public.booking_day_controls(client_id,booking_date,service);

create table public.booking_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  service text, booking_date date not null, starts_at time, ends_at time,
  capacity_reduction integer, reason text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint booking_blocks_time_check check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint booking_blocks_capacity_check check (capacity_reduction is null or capacity_reduction >= 0)
);
create index ix_booking_blocks_lookup on public.booking_blocks(client_id,booking_date,service,active);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  legacy_reservation_id text, public_reference text,
  booking_date date not null, booking_time time, service text not null,
  customer_id uuid, customer_name text, customer_phone text, pax smallint not null,
  locale text, special_request text,
  status text not null default 'confirmed', legacy_status text,
  source_channel text not null default 'legacy_unknown', legacy_source text,
  table_id uuid, resource_id uuid, room text, arrived boolean,
  feedback_sent boolean, pre_dinner_sent boolean, balinese_package text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  legacy_created_at text, legacy_updated_at text, legacy_locale text,
  constraint reservations_pax_check check (pax > 0),
  constraint reservations_status_check check (status in ('pending','confirmed','cancelled','completed','no_show','legacy_unknown')),
  constraint reservations_source_check check (source_channel in ('widget','typebot','whatsapp_ai','manager_manual','phone','walk_in','api_partner','demo','legacy_unknown')),
  constraint reservations_client_id_id_key unique (client_id,id),
  constraint reservations_customer_fk foreign key (client_id,customer_id) references public.restaurant_customers(client_id,id) on update restrict on delete set null (customer_id),
  constraint reservations_table_fk foreign key (client_id,table_id) references public.restaurant_tables(client_id,id) on update restrict on delete set null (table_id),
  constraint reservations_resource_fk foreign key (client_id,resource_id) references public.reservable_resources(client_id,id) on update restrict on delete set null (resource_id)
);
create unique index uq_reservations_public_reference on public.reservations(client_id,public_reference) where nullif(public_reference,'') is not null;
create unique index uq_reservations_legacy_id on public.reservations(client_id,legacy_reservation_id) where nullif(legacy_reservation_id,'') is not null;
create index ix_reservations_day on public.reservations(client_id,booking_date,booking_time);
create index ix_reservations_availability on public.reservations(client_id,service,booking_date,booking_time,status);
create index ix_reservations_customer_phone on public.reservations(client_id,customer_phone);
create index ix_reservations_status_date on public.reservations(client_id,status,booking_date);
create index ix_reservations_table on public.reservations(client_id,table_id,booking_date,booking_time) where table_id is not null;
create unique index uq_reservations_resource_day on public.reservations(client_id,resource_id,booking_date) where resource_id is not null and status in ('confirmed','pending');

create table public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  reservation_id uuid, legacy_reservation_id text, rating smallint not null, comment text,
  submitted_at timestamptz not null default now(), legacy_feedback_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint feedbacks_rating_check check (rating between 1 and 5),
  constraint feedbacks_reservation_fk foreign key (client_id,reservation_id) references public.reservations(client_id,id) on update restrict on delete cascade
);
create unique index uq_feedbacks_reservation on public.feedbacks(client_id,reservation_id) where reservation_id is not null;
create unique index uq_feedbacks_legacy on public.feedbacks(client_id,legacy_feedback_id) where nullif(legacy_feedback_id,'') is not null;
create index ix_feedbacks_date on public.feedbacks(client_id,submitted_at desc);

create table public.booking_idempotency (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public."CLIENTES"(client_id) on update restrict on delete restrict,
  idempotency_key text not null, operation text not null, request_hash text not null,
  reservation_id uuid, status text not null default 'processing', response_code text,
  expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint booking_idempotency_status_check check (status in ('processing','succeeded','failed')),
  constraint booking_idempotency_reservation_fk foreign key (client_id,reservation_id) references public.reservations(client_id,id) on update restrict on delete set null (reservation_id)
);
create unique index uq_booking_idempotency on public.booking_idempotency(client_id,operation,idempotency_key);
create index ix_booking_idempotency_expiry on public.booking_idempotency(expires_at);

create function public.hospitality_set_updated_at() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin new.updated_at = now(); return new; end $$;

create trigger hospitality_restaurant_customers_updated_at before update on public.restaurant_customers for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_restaurant_tables_updated_at before update on public.restaurant_tables for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_reservable_resources_updated_at before update on public.reservable_resources for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_booking_capacity_slots_updated_at before update on public.booking_capacity_slots for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_booking_day_controls_updated_at before update on public.booking_day_controls for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_booking_blocks_updated_at before update on public.booking_blocks for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_reservations_updated_at before update on public.reservations for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_feedbacks_updated_at before update on public.feedbacks for each row execute function public.hospitality_set_updated_at();
create trigger hospitality_booking_idempotency_updated_at before update on public.booking_idempotency for each row execute function public.hospitality_set_updated_at();

alter table public.restaurant_customers enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.reservable_resources enable row level security;
alter table public.booking_capacity_slots enable row level security;
alter table public.booking_day_controls enable row level security;
alter table public.booking_blocks enable row level security;
alter table public.reservations enable row level security;
alter table public.feedbacks enable row level security;
alter table public.booking_idempotency enable row level security;

revoke all on table public.restaurant_customers, public.restaurant_tables, public.reservable_resources,
  public.booking_capacity_slots, public.booking_day_controls, public.booking_blocks,
  public.reservations, public.feedbacks, public.booking_idempotency from anon, authenticated;
grant all on table public.restaurant_customers, public.restaurant_tables, public.reservable_resources,
  public.booking_capacity_slots, public.booking_day_controls, public.booking_blocks,
  public.reservations, public.feedbacks, public.booking_idempotency to service_role;
revoke all on function public.hospitality_set_updated_at() from public, anon, authenticated;

commit;
