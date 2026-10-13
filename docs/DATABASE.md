# Base de datos y stores

## Entidades verificadas en código

`CLIENTES` contiene `client_id`, `public_token`, `status`, slugs, branding, `reservation_store` y configuración de servicio. Las reservas Supabase usan campos como `booking_date`, `booking_time`, `customer_name`, `customer_phone`, `pax`, `room`, `service`, `status`, `source_channel` y referencias legacy.

## reservation_store

El código distingue stores Supabase y legacy Sheets. `reservation_store` se lee desde `CLIENTES`; no debe interpretarse solo por el nombre. Las rutas legacy consultan Google Sheets y pueden fallar aunque la API de Supabase esté sana.

## ENABLE_LEGACY_SHEETS

La función desplegada corta todas las solicitudes antes del routing cuando `ENABLE_LEGACY_SHEETS !== 'true'`, devolviendo `503 LEGACY_SHEETS_DISABLED`. Activarla no migra datos: reabre las rutas que todavía dependen de Sheets. Su valor actual fue restaurado el 2026-10-14.

## Pendiente

No se ejecutaron consultas destructivas ni migraciones. RLS, RPC exactas, columnas completas y estado por tenant requieren revisión con acceso SQL autorizado.
