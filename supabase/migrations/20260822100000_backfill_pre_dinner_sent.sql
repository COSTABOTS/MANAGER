begin;

update public.reservations
set pre_dinner_sent = false
where pre_dinner_sent is null;

alter table public.reservations
alter column pre_dinner_sent set default false;

alter table public.reservations
alter column pre_dinner_sent set not null;

commit;
