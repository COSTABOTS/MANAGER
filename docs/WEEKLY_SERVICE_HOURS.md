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

Compatibilidad revisada contra `20260802110939_hospitality_phase1_schema.sql`: existe `hospitality_set_updated_at()`, `CLIENTES.client_id` se usa como FK `text` con `on update restrict/on delete restrict`, y el patrón de RLS/permisos coincide con las tablas Hospitality. La migración no depende de `booking_capacity_slots`, reservas ni RPC existentes.

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

## Validación Fase 2C

El harness SQL se corrigió para no usar `:'client_id'` dentro de bloques `DO $$`; ahora fija el valor con `set_config('weekly_test.client_id', ...)` y los bloques PL/pgSQL lo recuperan mediante `current_setting`. Las aserciones lanzan errores explícitos cuando una entrada inválida es aceptada, cuando se pierden las 21 reglas originales o cuando faltan permisos esperados.

El script cubre: 21 reglas válidas, 20 y 22 reglas, duplicados, weekdays fuera de `0..6`, servicio no permitido, ventanas invertidas/iguales, cruces de medianoche, servicio desactivado con horas, preservación ante rechazo, integridad y permisos. La concurrencia se deja como prueba de dos sesiones: una sesión mantiene abierta la transacción y otra debe esperar el `pg_advisory_xact_lock` del mismo tenant.

## Pruebas

La suite del helper tenía 8 tests PASS antes de este ajuste. Tras cambiar la política de medianoche no pudo ejecutarse de nuevo porque Deno no está disponible en el entorno y no se instaló ninguna herramienta. `git diff --check` se ejecutó correctamente. El harness SQL está preparado para `psql` contra una base desechable, exige `-v client_id=...` y termina con `rollback`; no se ha ejecutado.

La búsqueda del repositorio no encontró ningún consumidor actual de `WEEKLY_HOURS_ENABLED`; solo aparecen la migración y esta documentación. Por tanto no existe activación accidental, pero tampoco existe todavía una activación funcional integrada.

## Validación automatizada Fase 2D

Se prepararon:

- `.github/workflows/weekly-service-hours.yml`, limitado a pushes de `feature/weekly-service-hours` y ejecución manual;
- `supabase/tests/fixtures/booking_service_hours_fixture.sql`, con `pgcrypto`, `CLIENTES`, el trigger `updated_at` y los roles mínimos `anon`, `authenticated` y `service_role`;
- el harness SQL corregido para ejecutarse con `psql -v client_id=...`.

El workflow usa Deno `2.9.7` y PostgreSQL `16` efímero. Ejecuta `deno check`, `deno test`, prepara el fixture, aplica la migración solo al contenedor temporal y ejecuta las aserciones con `rollback`. No contiene URL, token, secreto ni credencial de Supabase.

El primer workflow `40187887238` ejecutó correctamente Deno setup, `deno check`, `deno test`, el fixture y la migración PostgreSQL. Falló únicamente al iniciar el harness SQL porque el `psql` del runner no soportaba el comando meta `\\error` en la línea 7. Esta corrección sustituye ese comando por una división SQL deliberadamente inválida bajo `ON_ERROR_STOP=1` y separa correctamente los casos de 22 entradas frente a 21 combinaciones únicas con duplicado.

Estado local: workflow y fixtures **PREPARADOS, NO EJECUTADOS** desde esta sesión. Deno y `psql` no están instalados localmente. La ejecución real quedará registrada por GitHub Actions cuando la rama se publique/ejecute; no se debe declarar PASS antes de consultar ese run.

No se añadió conversión automática entre `start_time/end_time` SQL y `start/end` TypeScript porque todavía no existe integración de API. Esa adaptación pertenece a la fase de lectura posterior y debe probar formatos `HH:mm` y, si se admite, `HH:mm:ss` explícitamente.

## Fase 3A: adaptador aislado

Se preparan, sin importarlos desde `public-api`, `weeklyHoursAdapter.ts` y `weeklyHoursAdapter.test.ts`.

El adaptador:

- acepta `start_time/end_time` y aliases `start/end`;
- normaliza `HH:mm` y `HH:mm:00` a `HH:mm`;
- rechaza segundos distintos de `00` para no truncar silenciosamente una hora;
- valida weekday `0..6`, servicios canónicos y las 21 combinaciones únicas;
- devuelve `legacy` si `WEEKLY_HOURS_ENABLED` falta o es falso;
- devuelve `weekly` solo con configuración completa y válida;
- devuelve `WEEKLY_HOURS_CONFIG_INVALID` para configuración activa incompleta/inválida;
- devuelve `WEEKLY_HOURS_CONFIG_READ_FAILED` para errores de lectura, sin confundirlos con ausencia;
- no lee ni modifica capacidad.

Los tests cubren domingo, cena cerrada, legacy, configuración incompleta, aliases, formatos PostgreSQL, límites inclusivos/exclusivos, días cerrados, servicios inválidos y separación respecto a capacidad. No se ha ejecutado localmente porque Deno no está disponible; no se declara PASS hasta ejecutar CI.

### Compatibilidad pendiente

La futura integración debe combinar el resultado semanal con `SERVICES_ENABLED`, `BOOKING_INTERVAL`, `BOOKING_ENABLED/BOOKINGS_ENABLED`, `booking_capacity_slots` y `booking_day_controls` sin duplicar reglas. Un servicio semanalmente abierto pero ausente/desactivado en `SERVICES_ENABLED` debe permanecer no reservable; esta precedencia aún no está implementada.

Las capacidades siguen siendo independientes: el adaptador no crea ni modifica slots. Debe revisarse el conflicto conocido entre `weekday 0..6` y consultas que usan `EXTRACT(ISODOW)` (domingo `7`) antes de tocar disponibilidad; las RPC actuales no se modificaron.

## Fase 3B: integración local de disponibilidad

En el worktree aislado `weekly-hours-availability` se preparó la integración local en:

- `routes/availabilityByDay.ts`;
- `_shared/reservation-store/supabaseReservationStore.ts`;
- `_shared/booking-hours/weeklyHoursAdapter.ts`.

El store Supabase consulta primero `SETTINGS`. Si el flag semanal está ausente/falso, no consulta `booking_service_hours` y conserva el flujo legacy. Si está activo, carga y valida las 21 reglas; una lectura fallida o configuración inválida se propaga como error controlado. Los slots de restaurante se filtran con inicio inclusivo y fin exclusivo. Balinesa queda fuera. Un servicio no incluido en `SERVICES_ENABLED` no queda disponible aunque su regla semanal esté abierta.

`availabilityByDay` aplica la misma decisión para día cerrado, servicio desactivado y `BOOKINGS_ENABLED`; Fully Booked y controles diarios siguen teniendo precedencia. No se modificaron `reservation/create`, RPC, capacidades ni Manager.

Estado: **CÓDIGO PREPARADO LOCALMENTE; TESTS DE INTEGRACIÓN PENDIENTES; NO DESPLEGADO**. El worktree original con cambios de `public-api` permanece intacto. El CI PASS del adaptador corresponde al commit `3455940` (run `40189762500`); esta integración aún no se ha publicado ni ejecutado en CI. Se añadieron mocks aislados para comprobar que legacy no consulta la tabla semanal y que el modo activo consulta las 21 reglas y `SERVICES_ENABLED`.

La Fase 3B.1 añade regresiones aisladas para domingo con `weekday=0`, capacidad general `weekday=NULL`, Fully Booked y errores de lectura. El workflow se activa también en `feature/weekly-hours-availability` y prepara checks/tests de `availabilityByDay` y `SupabaseReservationStore`. El `availabilityByDay` mantiene su contrato: un día abierto solo informa estado de horario/controles; no afirma disponibilidad de plazas por sí mismo.

La corrección local usa `getBookingWeekday()` con `getUTCDay()` (domingo `0`) para coincidir con el constraint del esquema. No se modifica ninguna RPC. El flujo Sheets sigue fuera de esta integración semanal y queda como riesgo pendiente antes de activar el modelo para tenants que usen ese store.

## Riesgos pendientes

- La equivalencia entre `SETTINGS` real y todos los entornos debe verificarse antes de integrar la activación.
- El helper aún no está conectado a disponibilidad/creación; no ofrece protección de producción.
- No se ha probado el SQL contra PostgreSQL aislado.
- Debe definirse control de concurrencia y permisos de Manager antes de exponer el guardado.
- No ejecutar la migración hasta revisar el esquema real y obtener autorización explícita.
- El harness SQL no se considera PASS hasta ejecutarse con PostgreSQL/Supabase desechable y roles `anon`, `authenticated` y `service_role` disponibles.

## Plan posterior y recuperación

1. Validar la migración y las funciones en una base aislada.
2. Implementar lectura/guardado en Manager con activación atómica.
3. Integrar el resolver en availability y create, manteniendo legacy apagado por defecto.
4. Ejecutar regresión por tenant y canal.
5. Desplegar solo con diff, bundle y smoke tests aprobados.

La recuperación consiste en no activar `WEEKLY_HOURS_ENABLED` y, si una fase posterior ya estuviera integrada, revertir únicamente el commit de integración y restaurar el artefacto anterior. La migración no se ha ejecutado, por lo que no requiere rollback de datos en este punto.
