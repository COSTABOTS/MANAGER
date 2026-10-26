-- Disposable PostgreSQL 16 fixture only. Apply before the versioned Phase 1 schema.
\set ON_ERROR_STOP on
\ir weekly_rpc_environment_guard.sql
create table public."CLIENTES" (client_id text);
create table public."PROFILES" (id integer);
create table public."SETTINGS" (
  id bigint generated always as identity primary key,
  "CLIENTE_ID" text not null,
  "CLAVE" text not null,
  "VALOR" text
);

insert into public."CLIENTES"(client_id) values
  ('TEST-RPC-LEGACY'), ('TEST-RPC-WEEKLY'), ('TEST-RPC-OTHER');

do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
