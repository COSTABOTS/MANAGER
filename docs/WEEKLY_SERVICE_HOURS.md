# Horarios semanales por servicio

Estado actualizado (25/10/2026): **motor, adaptador y disponibilidad implementados y validados en la rama; migración probada en PostgreSQL aislado; NO MIGRADO NI DESPLEGADO**. La protección semanal de creación y la RPC siguen pendientes. El fix de antelación de 30 minutos se ha portado localmente a esta rama, sin despliegue.

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

El helper `supabase/functions/_shared/booking-hours/weeklyHours.ts` mantiene la convención weekday y el intervalo semiabierto; rechaza cruces de medianoche en V1. Ya se utiliza en la disponibilidad de la rama, pero no en `reservation/create` ni en la RPC.

## Fases y estado

| Fase | Estado | Evidencia |
|---|---|---|
| Motor puro semanal | Implementado localmente | `weeklyHours.ts` y `weeklyHours.test.ts` |
| Modelo SQL | Implementado localmente | migración indicada arriba |
| Test SQL aislado | PASS en CI; no ejecutado en producción | `supabase/tests/booking_service_hours_isolated.sql`, run `40195377722` |
| Integración de disponibilidad | Implementada y validada en rama; no desplegada | `availabilityByDay.ts`, `SupabaseReservationStore` y 57/57 tests locales |
| Integración de creación semanal y RPC | Pendiente | no existe guard semanal en `reservation/create` ni en la RPC versionada |
| Manager UI/guardado | Pendiente | no se modificó manager-api/UI |
| Migración remota | Pendiente/no ejecutada | producción intacta |

## Validación Fase 2C

El harness SQL se corrigió para no usar `:'client_id'` dentro de bloques `DO $$`; ahora fija el valor con `set_config('weekly_test.client_id', ...)` y los bloques PL/pgSQL lo recuperan mediante `current_setting`. Las aserciones lanzan errores explícitos cuando una entrada inválida es aceptada, cuando se pierden las 21 reglas originales o cuando faltan permisos esperados.

El script cubre: 21 reglas válidas, 20 y 22 reglas, duplicados, weekdays fuera de `0..6`, servicio no permitido, ventanas invertidas/iguales, cruces de medianoche, servicio desactivado con horas, preservación ante rechazo, integridad y permisos. La concurrencia se deja como prueba de dos sesiones: una sesión mantiene abierta la transacción y otra debe esperar el `pg_advisory_xact_lock` del mismo tenant.

## Pruebas

En la sesión original de Fase 2C no se pudo repetir la suite por falta de Deno ni ejecutar el harness SQL. Ese bloqueo histórico quedó superado por los runs aislados posteriores; véase el estado actualizado de Fase 3B y 4C al final de este documento. El harness exige `-v client_id=...` y termina con `rollback`.

En Fase 2C no existía consumidor de `WEEKLY_HOURS_ENABLED`. Esta observación es histórica: en la rama actual lo leen la disponibilidad diaria y el store de disponibilidad Supabase. No existe integración de escritura/activación en Manager ni validación semanal de creación.

## Validación automatizada Fase 2D

Se prepararon:

- `.github/workflows/weekly-service-hours.yml`, activado para `feature/weekly-service-hours`, `feature/weekly-hours-availability` y ejecución manual;
- `supabase/tests/fixtures/booking_service_hours_fixture.sql`, con `pgcrypto`, `CLIENTES`, el trigger `updated_at` y los roles mínimos `anon`, `authenticated` y `service_role`;
- el harness SQL corregido para ejecutarse con `psql -v client_id=...`.

El workflow usa Deno `2.9.7` y PostgreSQL `16` efímero. Ejecuta `deno check`, `deno test`, prepara el fixture, aplica la migración solo al contenedor temporal y ejecuta las aserciones con `rollback`. No contiene URL, token, secreto ni credencial de Supabase.

El primer workflow `40187887238` ejecutó correctamente Deno setup, `deno check`, `deno test`, el fixture y la migración PostgreSQL. Falló únicamente al iniciar el harness SQL porque el `psql` del runner no soportaba el comando meta `\\error` en la línea 7. Esta corrección sustituye ese comando por una división SQL deliberadamente inválida bajo `ON_ERROR_STOP=1` y separa correctamente los casos de 22 entradas frente a 21 combinaciones únicas con duplicado.

El estado **PREPARADOS, NO EJECUTADOS** correspondía a la preparación inicial de 2D. Los runs posteriores de CI ejecutaron Deno y PostgreSQL temporal; el resultado vigente de 3B se registra más abajo. No se ha ejecutado SQL en Supabase real.

En 2D todavía faltaba la conversión entre `start_time/end_time` SQL y `start/end` TypeScript; el adaptador de Fase 3A ya la implementa y prueba para `HH:mm` y `HH:mm:00`.

## Fase 3A: adaptador aislado

En Fase 3A se prepararon `weeklyHoursAdapter.ts` y sus tests por separado. En la rama actual el adaptador ya se importa desde la disponibilidad de `public-api`.

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

Los tests cubren domingo, cena cerrada, legacy, configuración incompleta, aliases, formatos PostgreSQL, límites inclusivos/exclusivos, días cerrados, servicios inválidos y separación respecto a capacidad. Se ejecutaron localmente con Deno 2.9.7 (10/10 PASS) y en el CI de 3B.

### Compatibilidad pendiente

La disponibilidad semanal ya combina reglas, `SERVICES_ENABLED`, capacidades y controles diarios. En creación sigue pendiente esa precedencia. Riesgo abierto: si `SERVICES_ENABLED` falta o está vacío, el adaptador devuelve `null` (sin restricción adicional), mientras Manager y `widget/config` recurren a `CENA`; se necesita una política explícita antes de activar tenants. `BOOKINGS_ENABLED` se usa en disponibilidad diaria, pero no en creación; `BOOKING_ENABLED` no se consume en las Edge Functions revisadas.

Las capacidades siguen siendo independientes: el adaptador no crea ni modifica slots. La disponibilidad ya usa domingo `0`, pero la RPC de creación versionada todavía compara con `EXTRACT(ISODOW)` (domingo `7`); la definición desplegada de esa RPC no se verificó en Fase 4A.

## Fase 3B: integración local de disponibilidad

En el worktree aislado `weekly-hours-availability` se preparó la integración local en:

- `routes/availabilityByDay.ts`;
- `_shared/reservation-store/supabaseReservationStore.ts`;
- `_shared/booking-hours/weeklyHoursAdapter.ts`.

El store Supabase consulta primero `SETTINGS`. Si el flag semanal está ausente/falso, no consulta `booking_service_hours` y conserva el flujo legacy. Si está activo, carga y valida las 21 reglas; una lectura fallida o configuración inválida se propaga como error controlado. Los slots de restaurante se filtran con inicio inclusivo y fin exclusivo. Balinesa queda fuera. Un servicio no incluido en `SERVICES_ENABLED` no queda disponible aunque su regla semanal esté abierta.

`availabilityByDay` aplica la misma decisión para día cerrado, servicio desactivado y `BOOKINGS_ENABLED`; Fully Booked y controles diarios siguen teniendo precedencia. No se modificaron `reservation/create`, RPC, capacidades ni Manager.

Estado vigente: **INTEGRACIÓN DE DISPONIBILIDAD VALIDADA EN RAMA; NO DESPLEGADA**. HEAD `5739d5790d02d9d51e90574e9c6a3beb4a87fd72`: 57/57 tests Deno locales PASS y GitHub Actions run `40195377722` SUCCESS, incluidos PostgreSQL temporal, migración aislada y aserciones SQL. El worktree `manager-audit` con cambios preexistentes de `public-api` permanece fuera de esta integración. Los mocks comprueban que legacy no lee la tabla semanal y que el modo activo consulta las 21 reglas y `SERVICES_ENABLED`.

La Fase 3B.1 añade regresiones aisladas para domingo con `weekday=0`, capacidad general `weekday=NULL`, Fully Booked y errores de lectura. El workflow se activa también en `feature/weekly-hours-availability` y prepara checks/tests de `availabilityByDay` y `SupabaseReservationStore`. El `availabilityByDay` mantiene su contrato: un día abierto solo informa estado de horario/controles; no afirma disponibilidad de plazas por sí mismo.

La corrección local usa `getBookingWeekday()` con `getUTCDay()` (domingo `0`) para coincidir con el constraint del esquema. No se modifica ninguna RPC. El flujo Sheets sigue fuera de esta integración semanal y queda como riesgo pendiente antes de activar el modelo para tenants que usen ese store.

## Riesgos pendientes

- La equivalencia entre `SETTINGS` real y todos los entornos debe verificarse antes de integrar la activación.
- El helper protege disponibilidad solo en esta rama; creación semanal y RPC siguen sin protección y no hay despliegue.
- El SQL pasó PostgreSQL aislado en CI; su equivalencia con el esquema y la RPC activos en producción sigue no verificada.
- Debe definirse control de concurrencia y permisos de Manager antes de exponer el guardado.
- No ejecutar la migración hasta revisar el esquema real y obtener autorización explícita.
- El harness SQL pasó en PostgreSQL desechable con roles de fixture; no equivale a una migración ni a una comprobación de producción.

## Plan posterior y recuperación

1. Validar la migración y las funciones en una base aislada.
2. Implementar lectura/guardado en Manager con activación atómica.
3. Conservar la integración de availability ya validada e integrar el guard semanal en create y la RPC sin modificar tenants legacy.
4. Ejecutar regresión por tenant y canal.
5. Desplegar solo con diff, bundle y smoke tests aprobados.

La recuperación consiste en no activar `WEEKLY_HOURS_ENABLED` y, si una fase posterior ya estuviera integrada, revertir únicamente el commit de integración y restaurar el artefacto anterior. La migración no se ha ejecutado, por lo que no requiere rollback de datos en este punto.

## Fases 4A y 4C: creación y antelación pública

La auditoría 4A trazó `reservation/create` hacia `resolveReservationStore`: Supabase llama a `create_hospitality_reservation` y Sheets añade a `RESERVAS!A:S`. Ninguno de esos caminos aplica aún horarios semanales al crear en esta rama. La RPC versionada contiene capacidad, controles diarios, bloques e idempotencia, pero usa `EXTRACT(ISODOW)` y no valida las 21 reglas. No se consultó la RPC realmente desplegada; su definición permanece **NO VERIFICADA**. Manager manual, walk-ins y Balinesa son caminos independientes.

En 4C se respaldaron, copiaron selectivamente y compararon por SHA-256 los seis archivos pendientes del worktree `fix/public-reservation-30min`, basado en `ad2c218`. El código temporal incorporado en esta rama usa `Europe/Madrid`, instantes reales, límite inclusivo de 30 minutos y rechazo de horas locales inexistentes o ambiguas. Filtra `availability/by-hour` y revalida en `reservation/create` antes de invocar el store, tanto para Supabase como para Sheets. **Esto no implementa el guard semanal de creación ni modifica la RPC.**

Validación local de 4C con Deno portátil 2.9.7 y dependencias cacheadas: motor 8/8, adaptador 10/10 y disponibilidad/store 39/39 (total Fase 3B: 57/57); tests específicos del fix 8/8 PASS. Los tres tests denominados de integración son seams de lógica y no ejecutan el handler completo ni escriben en stores reales. `deno check` de `public-api/index.ts` falla con 45 errores; la copia temporal del commit base `ad2c218` devuelve también 45 y los encabezados de error coinciden. Un test histórico de shadow-read mantiene una expectativa preexistente sobre `reservation_shadow_read` y falla fuera de la batería semanal; no se cambió para aparentar un PASS.

La comparación 4C.1 contra un worktree desechable del commit `5739d579` reprodujo exactamente los 45 errores del `deno check` global, con la misma secuencia de códigos TypeScript, y el mismo fallo histórico de `shadowComparison.test.ts` (9/10 tests: la aserción busca `reservation_shadow_read` en `clients.ts`). Esos fallos no se han corregido ni ocultado. En la rama integrada volvieron a pasar los checks de motor, adaptador y disponibilidad, los 57/57 tests semanales y de disponibilidad, y los 8/8 tests temporales. El workflow conserva PostgreSQL y SQL aislados y añade estos 8 tests temporales con `--no-check`, porque el chequeo global heredado sigue fallando; esto no equivale a un typecheck completo de `public-api`.

Estado: **PORT LOCAL PROBADO; SIN MIGRACIÓN NI DESPLIEGUE**. Antes de una revisión de despliegue faltan el guard semanal de creación, la protección transaccional y corrección de weekday de la RPC, pruebas de handlers completos, la semántica de `SERVICES_ENABLED` ausente/vacío y verificación de la definición SQL activa. El resultado de CI del commit de consolidación debe registrarse separadamente cuando se ejecute; las pruebas locales no lo sustituyen.
