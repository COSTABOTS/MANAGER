-- Manual rollback only, after confirming all API consumers are disabled.
-- This script deliberately refuses to discard any configured tenant data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ declare v_has_rows boolean; begin
  if current_setting('costabots.allow_pool_hours_rollback', true) is distinct from 'reviewed-no-active-consumers' then
    raise exception 'Pool hours rollback requires explicit reviewed session marker';
  end if;
  if to_regclass('public.booking_pool_hours') is not null then
    execute 'select exists (select 1 from public.booking_pool_hours)' into v_has_rows;
    if v_has_rows then
      raise exception 'Pool hours rollback refuses to discard configured tenants';
    end if;
  end if;
end $$;

drop function if exists public.replace_booking_pool_hours(text,text,text,text);
drop function if exists public.get_booking_pool_hours_snapshot(text);
drop table if exists public.booking_pool_hours;
commit;
