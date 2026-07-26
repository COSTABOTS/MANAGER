alter table public."CLIENTES"
  add column if not exists booking_url text,
  add column if not exists public_url text,
  add column if not exists bot_url text,
  add column if not exists contact_phone text;
