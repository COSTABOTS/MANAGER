alter table public."CLIENTES"
  add column if not exists booking_slug text;

create unique index if not exists clientes_booking_slug_unique
  on public."CLIENTES" (booking_slug)
  where booking_slug is not null
    and booking_slug <> '';

update public."CLIENTES"
set booking_slug = 'safari'
where client_id = 'CB-SAFARI-001';

update public."CLIENTES"
set booking_slug = 'granditalia'
where client_id = 'CB-GRANDITALIA-001';

update public."CLIENTES"
set booking_slug = 'zacs'
where client_id = 'CB-ZACS-001';
