alter table public."CLIENTES"
  add column if not exists status text default 'ACTIVE',
  add column if not exists plan text default 'DEMO',
  add column if not exists expires_at timestamptz;

update public."CLIENTES"
set
  status = coalesce(nullif(trim(status), ''), 'ACTIVE'),
  plan = coalesce(nullif(trim(plan), ''), 'DEMO');
