# Horarios semanales por servicio

Estado de esta fase: **IMPLEMENTADO LOCALMENTE; NO VALIDADO EN BASE AISLADA; NO DESPLEGADO**.

## Objetivo

Modelar, sin activarlo todavía, siete días (`0=domingo ... 6=sábado`) y tres servicios por tenant: `DESAYUNO`, `ALMUERZO` y `CENA`. Una regla contiene `enabled`, `start_time` y `end_time`. El inicio es inclusivo y el fin exclusivo. V1 no admite ventanas que crucen medianoche.

## Modelo preparado

La migración local `supabase/migrations/20261025120000_booking_service_hours.sql` crea `public.booking_service_hours` con:

- `id uuid` como clave primaria;
- `client_id` con FK restrictiva a `public."CLIENTES"`;
- `weekday smallint` con `0..6`;
- `service` restringido a los tres servicios;
- `enabled boolean`, `start_time time`, `end_time time`;
- `UNIQUE(client_id, weekday, service)`;
- constraint: regla activa requiere horas no nulas y `start_time < end_time`; regla inactiva requiere ambas horas nulas;
- índice de lectura por `(client_id, weekday, service)`;
- `updated_at` mediante el trigger Hospitality existente.

La tabla tiene RLS activada, sin permisos para `anon`/`authenticated` y con permisos para `service_role`, siguiendo el patrón del esquema Hospitality existente.

## Activación por tenant

La activación está diseñada alrededor de la clave existente de `SETTINGS`: `WEEKLY_HOURS_ENABLED`. La migración no inserta ni cambia esa clave. Ausente o falsa significa comportamiento legacy. Una futura operación de Manager debe establecerla solo después de guardar y validar las 21 reglas.

`booking_service_hours_is_complete(client_id)` comprueba 21 filas, 7 días y 3 servicios. No se documenta la tabla como existente en producción: la migración no se ha ejecutado.

## Guardado atómico

`replace_booking_service_hours(client_id, rules jsonb)` exige exactamente 21 combinaciones únicas antes de borrar o insertar filas. La sustitución ocurre en una única invocación transaccional; si una constraint falla, la operación completa falla. La función es `SECURITY DEFINER`, fija `search_path = pg_catalog, public`, revoca ejecución pública y solo concede `service_role`.

La función toma además un `pg_advisory_xact_lock` derivado de `client_id`, de modo que dos guardados simultáneos del mismo tenant se serializan. Los tenants distintos no se bloquean entre sí.

La actualización conjunta de las reglas y de `WEEKLY_HOURS_ENABLED` todavía requiere integración posterior en Manager/API dentro de una transacción o procedimiento único. Hasta entonces la activación debe permanecer apagada.

## Compatibilidad

Los tenants sin activación explícita conservan el comportamiento legacy. El modelo no toca `booking_capacity_slots`, Fully Booked, reservas, RPC existentes, `reservation_store` ni `ENABLE_LEGACY_SHEETS`.

El helper local `supabase/functions/_shared/booking-hours/weeklyHours.ts` mantiene la convención weekday y el intervalo semiabierto; ahora rechaza explícitamente cruces de medianoche para esta V1. No se ha integrado aún en availability ni creación.

## Fases y estado

| Fase | Estado | Evidencia |
|---|---|---|
| Motor puro semanal | Implementado localmente | `weeklyHours.ts` y `weeklyHours.test.ts` |
| Modelo SQL | Implementado localmente | migración indicada arriba |
| Test SQL aislado | Preparado, no ejecutado | `supabase/tests/booking_service_hours_isolated.sql` |
| Integración availability/create | Pendiente | no se modificó public-api |
| Manager UI/guardado | Pendiente | no se modificó manager-api/UI |
| Migración remota | Pendiente/no ejecutada | producción intacta |

## Pruebas

La suite del helper tenía 8 tests PASS antes de este ajuste. Tras cambiar la política de medianoche no pudo ejecutarse de nuevo porque Deno no está disponible en el entorno y no se instaló ninguna herramienta. `git diff --check` sí se ejecutó correctamente. El SQL aislado está preparado para ejecutarse únicamente contra una base desechable con `:client_id` de fixture y rollback.

## Riesgos pendientes

- La equivalencia entre `SETTINGS` real y todos los entornos debe verificarse antes de integrar la activación.
- El helper aún no está conectado a disponibilidad/creación; no ofrece protección de producción.
- No se ha probado el SQL contra PostgreSQL aislado.
- Debe definirse control de concurrencia y permisos de Manager antes de exponer el guardado.
- No ejecutar la migración hasta revisar el esquema real y obtener autorización explícita.

## Plan posterior y recuperación

1. Validar la migración y las funciones en una base aislada.
2. Implementar lectura/guardado en Manager con activación atómica.
3. Integrar el resolver en availability y create, manteniendo legacy apagado por defecto.
4. Ejecutar regresión por tenant y canal.
5. Desplegar solo con diff, bundle y smoke tests aprobados.

La recuperación consiste en no activar `WEEKLY_HOURS_ENABLED` y, si una fase posterior ya estuviera integrada, revertir únicamente el commit de integración y restaurar el artefacto anterior. La migración no se ha ejecutado, por lo que no requiere rollback de datos en este punto.
