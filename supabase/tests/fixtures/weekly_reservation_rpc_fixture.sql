-- Disposable PostgreSQL 16 fixture only. Apply before the versioned Phase 1 schema.
\set ON_ERROR_STOP on
do $$
begin
  if current_database() !~ '^weekly_[a-z0-9_]*_test$'
     or inet_server_addr() <> inet '127.0.0.1'
     or current_setting('server_version_num')::integer / 10000 <> 16 then
    raise exception 'Disposable local PostgreSQL 16 database required';
  end if;
end $$;
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
