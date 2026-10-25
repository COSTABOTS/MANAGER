-- Disposable PostgreSQL fixture. Never run against production.
create extension if not exists pgcrypto;

create table if not exists public."CLIENTES" (
  client_id text primary key
);
insert into public."CLIENTES" (client_id) values ('TEST-WEEKLY-HOURS') on conflict do nothing;

create or replace function public.hospitality_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$ begin new.updated_at = now(); return new; end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit; end if;
end $$;
