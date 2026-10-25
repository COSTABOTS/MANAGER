# Base de datos y stores

## Entidades verificadas en código

`CLIENTES` contiene `client_id`, `public_token`, `status`, slugs, branding, `reservation_store` y configuración de servicio. Las reservas Supabase usan campos como `booking_date`, `booking_time`, `customer_name`, `customer_phone`, `pax`, `room`, `service`, `status`, `source_channel` y referencias legacy.

## reservation_store

El código distingue stores Supabase y legacy Sheets. `reservation_store` se lee desde `CLIENTES`; no debe interpretarse solo por el nombre. Las rutas legacy consultan Google Sheets y pueden fallar aunque la API de Supabase esté sana.

## ENABLE_LEGACY_SHEETS

La función desplegada corta todas las solicitudes antes del routing cuando `ENABLE_LEGACY_SHEETS !== 'true'`, devolviendo `503 LEGACY_SHEETS_DISABLED`. Activarla no migra datos: reabre las rutas que todavía dependen de Sheets. Su valor actual fue restaurado el 2026-10-14.

## Pendiente

No se ejecutaron consultas destructivas ni migraciones. RLS, RPC exactas, columnas completas y estado por tenant requieren revisión con acceso SQL autorizado.

## Modelo semanal preparado localmente

La tabla `public.booking_service_hours` está definida únicamente en la migración local `20261025120000_booking_service_hours.sql`; **no existe confirmación de que haya sido creada en producción** porque la migración no se ha ejecutado. Usa `weekday` 0=domingo…6=sábado, servicios cerrados/activos mediante `enabled` y ventanas `[start_time,end_time)`, sin cruces de medianoche.

La función `booking_service_hours_is_complete` exige 21 reglas. `replace_booking_service_hours` valida las 21 combinaciones antes de sustituirlas en una operación atómica. Ambas funciones tienen `SECURITY DEFINER`, `search_path` fijo, ejecución revocada para roles públicos y concedida solo a `service_role`.

La activación se reserva a `SETTINGS` mediante `WEEKLY_HOURS_ENABLED`, pero todavía no hay integración de escritura ni activación. Capacidades, Fully Booked, RPC de reservas, `reservation_store` y `ENABLE_LEGACY_SHEETS` no se modifican.
