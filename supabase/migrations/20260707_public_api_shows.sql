alter table public."CLIENTES"
  add column if not exists public_token text;

create unique index if not exists clientes_public_token_unique
  on public."CLIENTES" (public_token)
  where public_token is not null and public_token <> '';

create table if not exists public."SHOWS" (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  nombre text not null,
  tipo text not null default 'single',
  fecha text,
  dia text,
  hora text,
  activo boolean not null default true,
  visible_chatbot boolean not null default true,
  reservable boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shows_client_id_idx
  on public."SHOWS" (client_id);

create index if not exists shows_public_visible_idx
  on public."SHOWS" (client_id, activo, visible_chatbot, orden);

alter table public."SHOWS"
  add column if not exists client_id text,
  add column if not exists nombre text,
  add column if not exists tipo text default 'single',
  add column if not exists fecha text,
  add column if not exists dia text,
  add column if not exists hora text,
  add column if not exists activo boolean default true,
  add column if not exists visible_chatbot boolean default true,
  add column if not exists reservable boolean default true,
  add column if not exists orden integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
