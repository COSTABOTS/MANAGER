-- Phase 2D.2 preparation: load the 30 active Demo tables from Sheets.
-- REVIEW ONLY. Technical read-validation data; do not run twice and do not use as cutover.
begin;

do $guard$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public."CLIENTES"
    where client_id = 'CB-DEMO-002'
      and reservation_store = 'sheets'
      and reservation_shadow_read = false
  ) then
    raise exception 'DEMO_TABLE_SEED_ABORT: Demo must remain sheets/false';
  end if;

  select count(*) into v_count
  from public.restaurant_tables
  where client_id = 'CB-DEMO-002';
  if v_count <> 3 then
    raise exception 'DEMO_TABLE_SEED_ABORT: expected exactly 3 technical tables, found %', v_count;
  end if;

  if exists (
    select 1
    from public.restaurant_tables
    where client_id = 'CB-DEMO-002'
      and label not in ('S1', 'S2', 'T30')
  ) then
    raise exception 'DEMO_TABLE_SEED_ABORT: unexpected pre-existing Demo table';
  end if;

  if exists (
    select 1
    from public.reservations r
    join public.restaurant_tables t on t.id = r.table_id
    where r.client_id = 'CB-DEMO-002'
      and t.client_id <> r.client_id
  ) then
    raise exception 'DEMO_TABLE_SEED_ABORT: cross-tenant table reference detected';
  end if;
end
$guard$;

with desired(id, legacy_table_id, label, zone, capacity, active, display_order) as (
  values
    ('2c110001-0000-4000-8000-000000000001'::uuid, 'MESA-1781373334063', 'S1',  'interior', 2, true, 1),
    ('2c110002-0000-4000-8000-000000000002'::uuid, 'MESA-1781374270205', 'S2',  'interior', 6, true, 1),
    ('2c140003-0000-4000-8000-000000000003'::uuid, 'MESA-1781376214305', 'S3',  'interior', 4, true, 4),
    ('2c140004-0000-4000-8000-000000000004'::uuid, 'MESA-1781376248157', 'S4',  'interior', 2, true, 4),
    ('2c140005-0000-4000-8000-000000000005'::uuid, 'MESA-1781376253560', 'S5',  'interior', 2, true, 5),
    ('2c140006-0000-4000-8000-000000000006'::uuid, 'MESA-1781376258772', 'S6',  'interior', 2, true, 6),
    ('2c140007-0000-4000-8000-000000000007'::uuid, 'MESA-1781376262131', 'S7',  'interior', 2, true, 7),
    ('2c140008-0000-4000-8000-000000000008'::uuid, 'MESA-1781376991747', 'S10', 'interior', 4, true, 8),
    ('2c140009-0000-4000-8000-000000000009'::uuid, 'MESA-1781377031028', 'S11', 'interior', 6, true, 9),
    ('2c140010-0000-4000-8000-000000000010'::uuid, 'MESA-1781377051826', 'S12', 'interior', 2, true, 10),
    ('2c140011-0000-4000-8000-000000000011'::uuid, 'MESA-1781377060334', 'S13', 'interior', 2, true, 11),
    ('2c140012-0000-4000-8000-000000000012'::uuid, 'MESA-1781377067051', 'S15', 'interior', 2, true, 12),
    ('2c140013-0000-4000-8000-000000000013'::uuid, 'MESA-1781377071931', 'S16', 'interior', 2, true, 13),
    ('2c140014-0000-4000-8000-000000000014'::uuid, 'MESA-1781377077045', 'S17', 'interior', 2, true, 14),
    ('2c140015-0000-4000-8000-000000000015'::uuid, 'MESA-1781377082312', 'S18', 'interior', 2, true, 15),
    ('2c140016-0000-4000-8000-000000000016'::uuid, 'MESA-1781377087818', 'S19', 'interior', 2, true, 16),
    ('2c140017-0000-4000-8000-000000000017'::uuid, 'MESA-1781377094401', 'S21', 'interior', 2, true, 17),
    ('2c140018-0000-4000-8000-000000000018'::uuid, 'MESA-1781377099615', 'S22', 'interior', 2, true, 18),
    ('2c140019-0000-4000-8000-000000000019'::uuid, 'MESA-1781377106835', 'S23', 'interior', 2, true, 19),
    ('2c140020-0000-4000-8000-000000000020'::uuid, 'MESA-1781377111912', 'S24', 'interior', 2, true, 20),
    ('2c140021-0000-4000-8000-000000000021'::uuid, 'MESA-1781377118033', 'S25', 'interior', 2, true, 21),
    ('2c140022-0000-4000-8000-000000000022'::uuid, 'MESA-1781377122456', 'S26', 'interior', 2, true, 22),
    ('2c110003-0000-4000-8000-000000000003'::uuid, 'MESA-1781377147443', 'T30', 'terraza',  2, true, 23),
    ('2c140024-0000-4000-8000-000000000024'::uuid, 'MESA-1781377156717', 'T31', 'terraza',  2, true, 24),
    ('2c140025-0000-4000-8000-000000000025'::uuid, 'MESA-1781377168404', 'T32', 'terraza',  2, true, 25),
    ('2c140026-0000-4000-8000-000000000026'::uuid, 'MESA-1781377177887', 'T33', 'terraza',  2, true, 26),
    ('2c140027-0000-4000-8000-000000000027'::uuid, 'MESA-1781377195653', 'T34', 'terraza',  2, true, 27),
    ('2c140028-0000-4000-8000-000000000028'::uuid, 'MESA-1781377230954', 'T36', 'terraza',  2, true, 29),
    ('2c140029-0000-4000-8000-000000000029'::uuid, 'MESA-1781377239238', 'T37', 'terraza',  2, true, 30),
    ('2c140030-0000-4000-8000-000000000030'::uuid, 'MESA-1781769400979-0C783073', 'T40', 'terraza', 2, true, 31)
)
update public.restaurant_tables t
set legacy_table_id = d.legacy_table_id,
    zone = d.zone,
    capacity = d.capacity,
    active = d.active,
    display_order = d.display_order
from desired d
where t.client_id = 'CB-DEMO-002'
  and t.label = d.label;

with desired(id, legacy_table_id, label, zone, capacity, active, display_order) as (
  values
    ('2c140003-0000-4000-8000-000000000003'::uuid, 'MESA-1781376214305', 'S3',  'interior', 4, true, 4),
    ('2c140004-0000-4000-8000-000000000004'::uuid, 'MESA-1781376248157', 'S4',  'interior', 2, true, 4),
    ('2c140005-0000-4000-8000-000000000005'::uuid, 'MESA-1781376253560', 'S5',  'interior', 2, true, 5),
    ('2c140006-0000-4000-8000-000000000006'::uuid, 'MESA-1781376258772', 'S6',  'interior', 2, true, 6),
    ('2c140007-0000-4000-8000-000000000007'::uuid, 'MESA-1781376262131', 'S7',  'interior', 2, true, 7),
    ('2c140008-0000-4000-8000-000000000008'::uuid, 'MESA-1781376991747', 'S10', 'interior', 4, true, 8),
    ('2c140009-0000-4000-8000-000000000009'::uuid, 'MESA-1781377031028', 'S11', 'interior', 6, true, 9),
    ('2c140010-0000-4000-8000-000000000010'::uuid, 'MESA-1781377051826', 'S12', 'interior', 2, true, 10),
    ('2c140011-0000-4000-8000-000000000011'::uuid, 'MESA-1781377060334', 'S13', 'interior', 2, true, 11),
    ('2c140012-0000-4000-8000-000000000012'::uuid, 'MESA-1781377067051', 'S15', 'interior', 2, true, 12),
    ('2c140013-0000-4000-8000-000000000013'::uuid, 'MESA-1781377071931', 'S16', 'interior', 2, true, 13),
    ('2c140014-0000-4000-8000-000000000014'::uuid, 'MESA-1781377077045', 'S17', 'interior', 2, true, 14),
    ('2c140015-0000-4000-8000-000000000015'::uuid, 'MESA-1781377082312', 'S18', 'interior', 2, true, 15),
    ('2c140016-0000-4000-8000-000000000016'::uuid, 'MESA-1781377087818', 'S19', 'interior', 2, true, 16),
    ('2c140017-0000-4000-8000-000000000017'::uuid, 'MESA-1781377094401', 'S21', 'interior', 2, true, 17),
    ('2c140018-0000-4000-8000-000000000018'::uuid, 'MESA-1781377099615', 'S22', 'interior', 2, true, 18),
    ('2c140019-0000-4000-8000-000000000019'::uuid, 'MESA-1781377106835', 'S23', 'interior', 2, true, 19),
    ('2c140020-0000-4000-8000-000000000020'::uuid, 'MESA-1781377111912', 'S24', 'interior', 2, true, 20),
    ('2c140021-0000-4000-8000-000000000021'::uuid, 'MESA-1781377118033', 'S25', 'interior', 2, true, 21),
    ('2c140022-0000-4000-8000-000000000022'::uuid, 'MESA-1781377122456', 'S26', 'interior', 2, true, 22),
    ('2c140024-0000-4000-8000-000000000024'::uuid, 'MESA-1781377156717', 'T31', 'terraza', 2, true, 24),
    ('2c140025-0000-4000-8000-000000000025'::uuid, 'MESA-1781377168404', 'T32', 'terraza', 2, true, 25),
    ('2c140026-0000-4000-8000-000000000026'::uuid, 'MESA-1781377177887', 'T33', 'terraza', 2, true, 26),
    ('2c140027-0000-4000-8000-000000000027'::uuid, 'MESA-1781377195653', 'T34', 'terraza', 2, true, 27),
    ('2c140028-0000-4000-8000-000000000028'::uuid, 'MESA-1781377230954', 'T36', 'terraza', 2, true, 29),
    ('2c140029-0000-4000-8000-000000000029'::uuid, 'MESA-1781377239238', 'T37', 'terraza', 2, true, 30),
    ('2c140030-0000-4000-8000-000000000030'::uuid, 'MESA-1781769400979-0C783073', 'T40', 'terraza', 2, true, 31)
)
insert into public.restaurant_tables
  (id, client_id, legacy_table_id, label, zone, capacity, active, display_order)
select id, 'CB-DEMO-002', legacy_table_id, label, zone, capacity, active, display_order
from desired;

do $postflight$
declare
  v_count integer;
begin
  select count(*) into v_count from public.restaurant_tables
  where client_id = 'CB-DEMO-002' and active = true;
  if v_count <> 30 then
    raise exception 'DEMO_TABLE_SEED_ABORT: expected 30 active tables after seed, found %', v_count;
  end if;
end
$postflight$;

commit;
