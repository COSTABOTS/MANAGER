-- Only disposable PostgreSQL 16 databases may run the restaurant RPC fixtures.
-- The CI path requires a session marker and the exact Docker service IP measured
-- and checked against GitHub Actions' postgres service container by the workflow.
\set ON_ERROR_STOP on
create or replace function pg_temp.weekly_rpc_disposable_allowed(
  p_database text, p_server inet, p_version integer, p_marker text, p_expected_server text
) returns boolean language sql immutable set search_path = pg_catalog as $guard$
  select p_database ~ '^weekly_[a-z0-9_]*_test$'
    and p_version / 10000 = 16
    and (
      p_server = inet '127.0.0.1'
      or (
        p_server <<= inet '172.16.0.0/12'
        and p_marker = 'gha-isolated-postgres16'
        and host(p_server) = p_expected_server
      )
    )
$guard$;

do $guard_tests$
declare
  v_database text := current_database();
  v_server inet := inet_server_addr();
  v_version integer := current_setting('server_version_num')::integer;
  v_marker text := current_setting('costabots.weekly_rpc_test', true);
  v_expected_server text := current_setting('costabots.weekly_rpc_server_ip', true);
begin
  if pg_temp.weekly_rpc_disposable_allowed(v_database, v_server, v_version, v_marker, v_expected_server) is not true then
    raise exception 'Disposable local PostgreSQL 16 database required';
  end if;

  -- Exercise the rejection cases even when the actual server is localhost.
  if pg_temp.weekly_rpc_disposable_allowed('production', inet '127.0.0.1', 160015, null, null)
     or pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '127.0.0.1', 150015, null, null)
     or pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '172.18.0.2', 160015, null, '172.18.0.2')
     or pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '172.18.0.2', 160015, 'gha-isolated-postgres16', null)
     or pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '172.18.0.2', 160015, 'gha-isolated-postgres16', '172.18.0.3')
     or pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '10.1.2.3', 160015, 'gha-isolated-postgres16', '10.1.2.3') then
    raise exception 'Disposable database guard accepted an unauthorized environment';
  end if;
  if pg_temp.weekly_rpc_disposable_allowed('weekly_rpc_test', inet '172.18.0.2', 160015,
      'gha-isolated-postgres16', '172.18.0.2') is not true then
    raise exception 'Disposable database guard rejected the verified Docker service case';
  end if;
end
$guard_tests$;
