begin;

create table public.reservation_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null
    references public."CLIENTES"(client_id)
    on update restrict on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserts integer not null default 0,
  updates integer not null default 0,
  skips integer not null default 0,
  errors integer not null default 0,
  status text not null default 'running',
  error_summary jsonb not null default '[]'::jsonb,
  constraint reservation_sync_runs_status_check
    check (status in ('running', 'completed', 'partial', 'failed')),
  constraint reservation_sync_runs_counts_check
    check (inserts >= 0 and updates >= 0 and skips >= 0 and errors >= 0),
  constraint reservation_sync_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint reservation_sync_runs_error_summary_check
    check (jsonb_typeof(error_summary) = 'array')
);

create index ix_reservation_sync_runs_tenant_started
  on public.reservation_sync_runs(client_id, started_at desc);

create unique index uq_reservation_sync_runs_running
  on public.reservation_sync_runs(client_id)
  where status = 'running';

alter table public.reservation_sync_runs enable row level security;
revoke all on table public.reservation_sync_runs from public, anon, authenticated;
grant all on table public.reservation_sync_runs to service_role;

alter table public.reservations
  drop constraint reservations_source_check;

alter table public.reservations
  add constraint reservations_source_check
  check (source_channel in (
    'widget', 'typebot', 'whatsapp_ai', 'manager_manual', 'phone',
    'walk_in', 'api_partner', 'demo', 'legacy_unknown', 'sheets'
  ));

commit;
