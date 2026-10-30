# Horarios semanales por servicio

Estado actualizado (26/10/2026): **motor, adaptador, disponibilidad y guard de creación API validados en la rama; protección RPC semanal preparada y probada solo en PostgreSQL aislado; NO MIGRADO NI DESPLEGADO**. El fix de antelación de 30 minutos está integrado en la rama para la API y preparado localmente en la propuesta de RPC, sin despliegue de horarios semanales.

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

El helper `supabase/functions/_shared/booking-hours/weeklyHours.ts` mantiene la convención weekday y el intervalo semiabierto; rechaza cruces de medianoche en V1. La disponibilidad y `reservation/create` lo utilizan en esta rama. La nueva RPC está preparada solo en una migración local y validada en PostgreSQL desechable; ninguna de estas reglas semanales está desplegada.

## Fases y estado

| Fase | Estado | Evidencia |
|---|---|---|
| Motor puro semanal | Implementado localmente | `weeklyHours.ts` y `weeklyHours.test.ts` |
| Modelo SQL | Implementado localmente | migración indicada arriba |
| Test SQL aislado | PASS en CI; no ejecutado en producción | `supabase/tests/booking_service_hours_isolated.sql`, run `40195377722` |
| Integración de disponibilidad | Implementada y validada en rama; no desplegada | `availabilityByDay.ts`, `SupabaseReservationStore` y 57/57 tests locales |
| Integración de creación semanal y RPC | Guard API preparado en la rama; nueva RPC preparada solo localmente | tests Deno y PostgreSQL aislado; sin despliegue ni activación |
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

La disponibilidad semanal combina reglas, `SERVICES_ENABLED`, capacidades y controles diarios. Esta nota describe el estado histórico de 3A/3B; la política posterior para `SERVICES_ENABLED` ausente o vacío es **solo CENA**, tanto en disponibilidad como en el guard local de creación y en la propuesta SQL de 5B. No se activa ningún tenant por este cambio documental.

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
- Disponibilidad y guard de creación están preparados en la rama; la nueva RPC existe solo como migración local. La creación semanal sigue desprotegida en producción hasta un despliegue y activación autorizados.
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

## Requisito funcional transversal para la fase 5B (25/10/2026)

**Regla:** `SERVICES_ENABLED` indica qué servicios ofrece globalmente el tenant; `booking_service_hours` indica en qué día y tramo abre cada servicio de restaurante. Una reserva pública de `DESAYUNO`, `ALMUERZO` o `CENA` exige ambas condiciones, además de capacidad y ausencia de bloqueos. Una regla semanal abierta nunca reactiva un servicio globalmente desactivado. Con `WEEKLY_HOURS_ENABLED` ausente/falso no se aplica esta intersección nueva: rige el flujo legacy. `BALINESA` usa disponibilidad y RPC propias y queda fuera de las 21 reglas.

El ejemplo de Grand Italia es **ilustrativo, no dato ni cambio de producción**: `ALMUERZO,CENA,BALINESA` globales; `ALMUERZO` abierto solo domingo; `CENA` según su calendario; `BALINESA` independiente. La prueba SQL aislada de 5B incluye esta matriz con tenants ficticios: almuerzo dominical permitido, almuerzo lunes rechazado, cena lunes permitida y almuerzo dominical rechazado al retirar `ALMUERZO` de `SERVICES_ENABLED`. Cada rechazo comprueba cero nuevas reservas y cero escrituras persistentes de idempotencia. La prueba balinesa separada y la inserción manual se conservan.

**Implementación local, no desplegada:** el adaptador semanal normaliza `SERVICES_ENABLED` y usa solo `CENA` si la clave falta o está vacía. Si el valor es explícito y contiene únicamente `BALINESA` (o ningún servicio de restaurante reconocido), el conjunto de servicios de restaurante queda vacío: no se habilita `CENA` por defecto. `availabilityByDay`, `SupabaseReservationStore` y el guard local de `reservationCreate` combinan servicio global y horario semanal. La propuesta de migración `20261025180000_weekly_hospitality_reservation_guard.sql` aplica la misma distinción y comprueba primero el servicio global y después las 21 reglas, con inicio inclusivo y fin exclusivo. El guard de creación de API sigue apagado por defecto mediante `ENABLE_WEEKLY_CREATE_GUARD`; no activar un tenant semanal mientras API, RPC y migración no estén preparados y validados juntos. Los canales que consumen disponibilidad (Widget y Assistant) deben usar los resultados por fecha/servicio de la API; **queda pendiente verificar sus filtros locales** para garantizar que no oculten un servicio disponible solo en ciertos días. No se modifican en esta fase.

**Manager HOY, diseño futuro (no implementado):** hoy `getTodayTabServices` en `src/App.tsx` deriva las pestañas de `SERVICES_ENABLED`, sin resolver la apertura de la fecha. `TODAY_TAB_SERVICES` incluye `BALINESA`: al evaluar una configuración que contiene solo `BALINESA`, la pestaña resultante es `BALINESA`, no `CENA`. La caída a `CENA` ocurre únicamente si la lista normalizada no aporta ningún servicio visible. Mantener visibles las pestañas de los servicios globales y, adicionalmente, cualquier servicio con reservas preexistentes en la fecha aunque ahora esté global o semanalmente cerrado. Mostrar un estado por fecha (abierto/cerrado/horario) separado de las reservas existentes; impedir nuevas reservas públicas en servicios cerrados, sin ocultar ni borrar reservas ni impedir la gestión manual por esta sola regla. Se necesita consulta/estado de horarios semanal para la fecha y pruebas de cambio de día, cierres posteriores a reservas y Balinesa.

**Capacidad, incompatibilidad pendiente:** el guard semanal no crea capacidad y una apertura sin slot disponible no basta para reservar. Pero `saveSettings` de `manager-api/index.ts` llama a `provisionDinnerCapacitySlots`, que aún inserta franjas generales `CENA` con capacidad positiva `20` desde `CENA_START` hasta `CENA_END` **incluyendo el fin** cuando faltan, aunque no se haya definido política para el nuevo calendario. Esas franjas generales (`weekday=NULL`) pueden quedar como capacidad antigua; la validación semanal impide usarlas fuera del horario, pero no deben confundirse con apertura ni rellenar automáticamente nuevos días/servicios. Antes de editar/activar horarios semanales se necesita separar el guardado de Settings del aprovisionamiento automático, definir política explícita para capacidad, preservar ceros existentes y probar franjas específicas de domingo. No se cambia Manager en 5B.

**Incompatibilidades/pendientes de 5B:** la migración SQL local controla la intersección para el camino Supabase RPC, pero todavía no está aplicada; Sheets depende del guard de API y del interruptor global apagado por defecto. La RPC propuesta añade una lectura de `SETTINGS` para decidir el flag incluso en tenants legacy; si esa lectura falla, podría introducir un rechazo nuevo. La comparación legacy aislada confirma resultados con lectura sana, pero **no resuelve ese riesgo operativo**. Manager HOY aún no expresa cierre por día. `widget/config` ofrece servicios globales, no sustituye la disponibilidad por fecha. La activación atómica de las 21 reglas y el flag, el control de errores, los tests completos por canal y la compatibilidad con el comportamiento legacy requieren validación previa al despliegue. Este apartado actualiza estados históricos anteriores del documento; ninguna funcionalidad nueva ha sido desplegada.

**Validación local adicional del caso `BALINESA` sola (26/10/2026):** Deno portátil 2.9.7: 80/80 tests PASS en motor, adaptador, disponibilidad/store, antelación pública y handler de creación; checks de motor, adaptador y disponibilidad PASS. Los tests del handler se ejecutan con `--no-check` por errores globales heredados de `public-api`, no como prueba de typecheck completo. PostgreSQL 16 local desechable: fixture, esquema, migración de horarios, RPC histórica, comparación legacy antes/después de la nueva migración, suite semanal y concurrencia PASS. El caso SQL `SERVICES_ENABLED='BALINESA'` rechaza CENA aunque su horario y capacidad estén abiertos; el adaptador y los mocks de disponibilidad y creación verifican el mismo caso. El parser TypeScript acepta los mismos separadores de lista que SQL. No se ejecutaron tests de Widget/Assistant ni migración en Supabase real.

## Fase 5B.1: revisión de compatibilidad de la RPC (sin cambio funcional)

**Decisión propuesta, aún no autorizada para despliegue:** mantener una única RPC pública de creación de restaurante (opción A), que valide semanal y legacy dentro de la misma transacción. La opción B, conservar la RPC antigua junto a otra semanal mientras `service_role` pueda ejecutar ambas, deja un bypass directo: la API puede seleccionar la nueva, pero otra llamada con ese privilegio puede invocar la antigua. Revocar la antigua rompe al store legacy actual; moverla tras una única puerta protegida equivale operativamente a A. Los locks por tenant y slot, capacidad e idempotencia permanecen dentro de la única RPC propuesta.

**Conflicto no resuelto:** la RPC propuesta necesita leer `SETTINGS` para distinguir legacy de semanal. Si esa lectura falla, no existe información fiable para saber cuál es el tenant. Continuar por legacy conservaría disponibilidad pero permitiría un bypass semanal; fallar cerrado protege la regla semanal pero puede bloquear una reserva legacy. La propuesta actual falla cerrada. La prueba SQL aislada reproduce ambos rechazos y verifica cero reservas y cero filas de idempotencia; no demuestra que la continuidad legacy quede garantizada. No cambiar la RPC ni activar tenants semanales hasta aceptar explícitamente este riesgo o diseñar una fuente de activación independiente y fiable, con su propia revisión de disponibilidad y permisos.

**Margen de 30 minutos:** `reservation/create` lo valida antes del store, pero la RPC de restaurante recibe fecha y hora sin una comprobación equivalente. Una llamada directa autorizada a la RPC puede omitir el guard de la API. Para tenants semanales, antes de activar el modelo debe añadirse una validación transaccional en la única RPC: resolver `booking_date` + `booking_time` en `Europe/Madrid` como instante único, rechazar horas inexistentes/ambiguas y exigir `instante >= clock_timestamp() + interval '30 minutes'`, sin redondeos. Debe limitarse al modo semanal si se desea preservar exactamente la semántica legacy. Probar segundo/milisegundo, medianoche y DST con reloj controlado en PostgreSQL aislado antes de implementarla. La viabilidad exacta de esa resolución SQL aún está pendiente; no se declara protegido el acceso directo.

**Manager y capacidad:** en `src/App.tsx`, `TODAY_TAB_SERVICES` contiene los cuatro servicios y `getTodayTabServices(['BALINESA'])` devuelve `['BALINESA']`; HOY no usa la apertura diaria. En `manager-api/index.ts`, `saveSettings` llama a `provisionDinnerCapacitySlots` para tenants Supabase: solo si el payload incluye `CENA_START`, `CENA_END` y un `BOOKING_INTERVAL` válido, inserta slots generales de CENA que faltan, con capacidad 20 e incluyendo la hora final. No cambia slots existentes ni activa por sí mismo `SERVICES_ENABLED`, pero puede dejar capacidad positiva antigua en horas cerradas. El guard semanal debe seguir prevaleciendo sobre esos slots; separar provisión y horario requerirá una fase posterior, sin modificar ahora la interfaz ni los datos.

**Pruebas locales de 5B.1:** Deno 2.9.7 repite los 80/80 tests PASS y los checks específicos PASS; los tests del handler siguen bajo `--no-check` por los 45 errores globales heredados. En PostgreSQL 16 desechable pasan la comparación legacy, las 21 reglas, la suite semanal y el harness de concurrencia. La suite semanal simula la desaparición temporal de `SETTINGS`: la RPC propuesta devuelve `WEEKLY_HOURS_CONFIG_READ_FAILED` tanto para el tenant semanal como para el legacy y comprueba cero escrituras persistentes. Este resultado confirma el conflicto, no lo soluciona. La RPC propuesta no se modificó en 5B.1; tampoco se añadieron permisos ni guard temporal SQL. **Estado: NO-GO para activación o despliegue hasta resolver la política de fallo de activación y la protección temporal de llamadas directas.**

## Fase 5B.2: cierre local de seguridad de la RPC (26/10/2026)

**Decisión de seguridad:** se mantiene una sola `public.create_hospitality_reservation(text,text,jsonb)`. La lectura del flag `WEEKLY_HOURS_ENABLED` falla cerrada con `WEEKLY_HOURS_CONFIG_READ_FAILED` si `SETTINGS` no puede consultarse; jamás se presupone legacy. Es una protección necesaria contra un bypass semanal, pero implica que un fallo de lectura de `SETTINGS` puede suspender temporalmente las creaciones incluso para tenants legacy. Con lectura sana y flag ausente/falso, la rama legacy conserva su semántica anterior; la nueva regla temporal SQL no se ejecuta. No se ha activado el guard ni cambiado una configuración real.

**Antelación en la RPC propuesta:** la nueva migración local añade `hospitality_weekly_reservation_time_eligible(date,time,timestamptz)`, que resuelve el horario civil en `Europe/Madrid` a un instante único, rechaza horas inexistentes y ambiguas en los cambios CET/CEST y exige `instante >= ahora + interval '30 minutes'` con segundos y milisegundos, sin redondear. El reloj de producción procede de `hospitality_weekly_reservation_clock()` sin parámetros ni lectura de GUC/payload. Ambos helpers son invocables por la RPC `SECURITY DEFINER`, pero no tienen permiso `EXECUTE` directo para `anon`, `authenticated` o `service_role`. La RPC evalúa la regla solo con el modo semanal activo y justo antes de escribir `booking_idempotency` o `reservations`, después de los locks y de capacidad/bloqueos. Un reintento idempotente de una creación ya exitosa conserva la respuesta original incluso si la hora ha pasado. El helper comprueba los desplazamientos de una y dos horas alrededor de la conversión de PostgreSQL; la cobertura es la transición CET/CEST moderna de `Europe/Madrid`, no una garantía sobre todas las transiciones históricas posibles.

**Pruebas realmente ejecutadas:** Deno portátil 2.9.7: checks específicos de motor, adaptador y disponibilidad PASS; 80/80 tests PASS (21 motor/adaptador, 40 disponibilidad/store, 19 antelación y creación). Los tests de handler se ejecutaron con `--no-check` por errores del typecheck global, que no se declaran resueltos. Con el mismo Deno y comando, el HEAD publicado `69b607f` y el worktree actual devuelven ambos **46 diagnósticos TS con idéntica distribución por código**; por tanto esta fase no añadió errores. El registro histórico de 45 corresponde a comparaciones contra commits anteriores, no al HEAD actual. PostgreSQL 16 local desechable: migración propuesta aplicada solo allí, comparación legacy PASS, tests de las 21 reglas PASS, suite RPC `WEEKLY_RPC_PASS` y harness de concurrencia `CONCURRENCY_PASS`. La suite RPC verifica pasado, +29:59, +30:00, +30:01, milisegundos, marzo/octubre, hora inexistente/ambigua, reintento, permisos de helpers y cero reservas/filas de idempotencia tras rechazo. El reloj fijo usado por esos casos reemplaza la función solo dentro de una transacción del entorno desechable y se revierte con `ROLLBACK`. Ninguna prueba utilizó Supabase real.

**`deno.lock`:** en esta rama/HEAD `git ls-files deno.lock` no devuelve ninguna ruta; no hay eliminación staged ni unstaged de ese archivo ni contenido de HEAD que restaurar. Una generación previa no versionada se retiró antes de esta fase. Las ejecuciones actuales usaron `--no-lock`; el estado final debe confirmar que no se ha creado otro lockfile. No se han descartado los demás cambios locales.

**Observabilidad propuesta, no implementada:** alerta inmediata ante cualquier `WEEKLY_HOURS_CONFIG_READ_FAILED`, correlacionando código de error, request ID y un identificador de tenant no personal o seudonimizado; medir tasa de rechazo por tenant y aparición de `RESERVATION_TIME_PASSED` en la RPC. Nunca registrar payloads, nombres, teléfonos, tokens ni credenciales. El código de error de lectura permite distinguir esta causa de agotamiento de capacidad. Debe definirse quién recibe la alerta y el umbral operativo antes de activar tenants.

**Activación gradual y recuperación propuestas, no ejecutadas:** primero verificar migración/RPC/API y smoke tests de solo lectura, después habilitar el guard global de API y solo entonces activar `WEEKLY_HOURS_ENABLED` para un tenant con 21 reglas válidas y capacidad revisada; monitorizar antes de seguir. Si se necesita volver a la RPC anterior, no restaurarla mientras algún tenant semanal esté activo: abriría una vía de escritura sin protección. Requiere una intervención autorizada para detener nuevas creaciones o desactivar de forma controlada la activación semanal, verificar el estado, restaurar desde una definición SQL anterior verificada y repetir smoke tests. No se presume que revertir una migración SQL sea automático ni que un número de versión baste como respaldo. El camino Sheets sigue dependiendo del guard de API, no de esta RPC. Manager manual, walk-ins y Balinesa no usan el nuevo helper.

**Pendiente antes de producción:** revisión independiente del diff y del plan de despliegue/rollback; reconciliar la definición SQL activa en producción con la fuente versionada; aceptación operativa del fail-closed de `SETTINGS`; definir observabilidad y secuencia de activación; validar conjuntamente API, RPC y capacidades con tenants de prueba; resolver o acotar los 46 diagnósticos globales presentes tanto en HEAD como en este worktree. En una carrera extrema, si el umbral de 30 minutos se cruza después del guard HTTP pero antes del guard SQL, la RPC rechazará sin escribir; comprobar el mapeo de ese error hacia HTTP antes de desplegar. **Preparado para consolidación/revisión en GitHub; NO APTO aún para producción.**

## Fase 5B.3: respuesta pública a rechazos de la RPC (26/10/2026)

**Implementado solo localmente:** `SupabaseReservationStore.createReservation` reconoce exclusivamente un error PostgREST con SQLSTATE `P0001` y un mensaje exactamente igual a uno de los códigos públicos permitidos; lo convierte en un error tipado. No analiza fragmentos de mensajes ni propaga detalles SQL. `reservationCreate` transforma `RESERVATION_TIME_PASSED` en HTTP 409 con el contrato habitual `{ok:false,code,error,message}` incluso si el reloj cruza el límite entre la comprobación de la API y el intento de escritura SQL. No incluye `reservation_created` ni `id_reserva` en el rechazo. `RESERVATION_OUTSIDE_WEEKLY_HOURS`, `SERVICE_NOT_ENABLED` y `BOOKINGS_DISABLED` reciben 409; las configuraciones semanales inválidas o ilegibles reciben 500 con código seguro; `AVAILABILITY_EXHAUSTED` recibe 409 únicamente cuando el handler ya confirmó modo semanal. En modo legacy, el error de capacidad de la RPC mantiene la respuesta genérica previa `RESERVATION_CREATE_FAILED`/500. Un SQLSTATE distinto, código no permitido o error interno continúa como 500 genérico. La ruta Sheets y la RPC de Balinesa no cambian.

**Prueba del flujo completo:** el test de `reservationCreate.weekly.test.ts` usa el handler real y `SupabaseReservationStore` con RPC simulada. El reloj inyectado permite pasar la validación inicial de +30:00; al invocar la RPC simulada avanza dos segundos y esta responde `P0001/RESERVATION_TIME_PASSED`. Se comprueban HTTP 409, código exacto, una sola llamada al store, ninguna escritura simulada y ausencia de datos de reserva creada. Otros tests verifican horario cerrado, configuración inválida/ilegible, capacidad semanal, error RPC inesperado, comportamiento legacy y Sheets. Son pruebas aisladas con mocks, no una llamada a Supabase real.

**Resultados locales:** Deno portátil 2.9.7: checks específicos PASS; **83/83 tests PASS**, incluidos los 80 anteriores y tres tests nuevos del handler. El typecheck global de `public-api/index.ts` sigue fallando con **46 diagnósticos**, la misma cantidad y distribución que el HEAD `69b607f`; no se declara PASS. En una base PostgreSQL 16 desechable recién creada pasaron el fixture, migraciones históricas, comparación legacy antes y después de la nueva migración, suite RPC y concurrencia. Las aserciones SQL originales de las 21 reglas también volvieron a pasar en otra base local desechable. Ninguna base remota se consultó.

**CI preparado, aún no ejecutado en GitHub:** el workflow conserva íntegramente las pruebas Deno y PostgreSQL anteriores. Añade una segunda base efímera `weekly_rpc_test`, aplica allí el esquema y RPC versionados, compara legacy antes y después, aplica la migración propuesta y ejecuta las aserciones y la concurrencia. Cada comando `psql` usa `ON_ERROR_STOP=1`. El workflow no contiene secretos ni URLs de Supabase real, ni comandos de deploy. Solo podrá declararse validado en CI después de publicarlo con autorización y observar la ejecución completa.

**Pendientes:** confirmar el sobre real de errores PostgREST/Supabase para `P0001` en un entorno aislado equivalente a Edge, además de los riesgos de activación, recuperación y typecheck global descritos arriba. No activar horarios ni desplegar API/RPC hasta revisión coordinada. **Estado: listo para revisión del trabajo local; no autorizado para producción.**

## Fase 5B.4: validación local de PostgREST y bloqueo de publicación (26/10/2026)

Se ejecutó PostgREST 14.18 portátil contra PostgreSQL 16 desechable en `127.0.0.1`. La procedencia del ejecutable se comprobó con el SHA-256 anunciado por su release oficial. El test `reservationCreate.postgrest.isolated.test.ts` ejercita el handler público real, `SupabaseReservationStore` y una llamada HTTP real a la RPC local; solo la lectura inicial de cliente y configuración usa mocks. Sus siete escenarios pasaron: `RESERVATION_TIME_PASSED`, `RESERVATION_OUTSIDE_WEEKLY_HOURS`, `SERVICE_NOT_ENABLED`, `AVAILABILITY_EXHAUSTED`, `WEEKLY_HOURS_CONFIG_INVALID`, `WEEKLY_HOURS_CONFIG_READ_FAILED` y error SQL inesperado. PostgREST entrega los rechazos esperados como HTTP 400, SQLSTATE `P0001` y `message` igual al código; el store y el handler devuelven los códigos públicos y estados 409/500 previstos, sin exponer el mensaje SQL inesperado ni informar una reserva creada. Las pruebas que alteraron el fixture local restauraron sus tablas y ajustes en `finally`. No se utilizó Supabase real.

Se repitieron localmente con Deno 2.9.7 los 83 tests de motor, adaptador, disponibilidad, store, antelación y creación: **83/83 PASS**. Pasaron los checks específicos. El check global de `public-api/index.ts` sigue fallando con el recuento heredado: 45 errores reportados por Deno (46 líneas diagnósticas `TS... [ERROR]`), como en el HEAD de referencia. En PostgreSQL aislado pasaron la comparación legacy, la suite RPC con rollback y la concurrencia efectiva (`CONCURRENCY_PASS`). El workflow nuevo de GitHub Actions continúa **preparado, no ejecutado**.

**Publicación bloqueada por la condición del usuario:** GitHub registra un deployment `Preview` creado por `vercel[bot]` para el SHA publicado `69b607f29bae8ffce2e70ecea0370c7f2385bd80` de esta rama (deployment ID `7314693516`, 25/10/2026). Por tanto, un push de la rama podría iniciar otro despliegue Preview. Fase 5B.5 autoriza un respaldo mediante commit exclusivamente local, pero no el push. Se requiere decidir y verificar de forma explícita cómo impedir ese despliegue antes de consolidar en GitHub bajo la restricción actual. Esto no autoriza desplegar ni activar horarios semanales.

## Fase 6A: borrador de interfaz semanal de Manager (local, 26/10/2026)

**Implementado localmente, no desplegado:** Settings muestra `WeeklyHoursEditor` solo en desarrollo y solo con `VITE_WEEKLY_HOURS_UI=true`. Sin el flag no aparece. El editor construye 21 reglas (7 días, 3 servicios) en un borrador de `localStorage` separado por `clientId`. No llama a `onSettingsSave`, `manager-api` ni Supabase. El botón existente «Guardar configuración» y los horarios legacy conservan su funcionamiento anterior; el borrador semanal no se envía con ellos. Solo los servicios presentes en `SERVICES_ENABLED` pueden editarse; al desactivarlos, las reglas guardadas permanecen en el borrador y vuelven a mostrarse al reactivarlos. Balinesa no tiene reglas semanales de restaurante. Los días cerrados conservan las horas solo en el borrador local; una futura conversión a filas SQL debe emitir `start_time` y `end_time` como `NULL` para esos días. Inicio inclusivo, fin exclusivo, sin cruce de medianoche.

**Verificación local:** seis tests puros del borrador PASS con Deno 2.9.7; `tsc --noEmit` PASS y `npm run build` PASS con permiso para escribir los artefactos locales de Vite. Preview aislada sin API: escritorio y móvil sin desbordamiento horizontal; domingo ALMUERZO 11:00–18:00 persistió tras recarga; al pasar a solo BALINESA desaparecieron los controles editables y el borrador se conservó. No se usaron Settings ni capacidades reales. El primer intento de build en sandbox falló por un panic del compilador instalado y el intento separado de Vite por denegación de escritura en `node_modules/.vite-temp`; el build completo posterior pasó sin cambiar dependencias.

**Integración pendiente:** falta una operación atómica de manager-api para guardar las 21 reglas y activar el flag por tenant. El `saveSettings` actual llama a `provisionDinnerCapacitySlots`, que puede crear capacidad de CENA: no reutilizarlo para el nuevo horario sin separar ese efecto. Manager HOY sigue derivando pestañas de `SERVICES_ENABLED`; todavía no indica apertura por fecha, pero esta fase no oculta reservas. La inspección de canales detectó filtros frontend legacy que pueden ocultar horas semanales válidas fuera de los rangos globales: `costabots-booking/src/components/StepOneAvailability.tsx` usa `isWithinServiceHours` después de `availability/by-hour`; `costabots-assistant/src/flows/table/BookingFlow.tsx` hace un filtro equivalente. Ambos usan fin inclusivo. Deben revisarse antes de declarar el calendario semanal integrado, sin modificar aquí Widget ni Assistant. La creación/RPC semanal permanece sin desplegar y ningún restaurante tiene el flag activado por esta fase.

## Fase 6B: persistencia semanal de Manager (local, sin despliegue)

La Fase 6A se conservó en el commit `bf7f524` (`feat: prepare weekly hours settings editor`), con solo sus seis archivos. Las Fases 6B y 6B.1 se prepararon después, en un commit separado.

**Contrato preparado:** `manager-api` incorpora `weeklyHours.get` (sin payload de horario) y `weeklyHours.save` (`rules` con 21 filas y `expected_revision` SHA-256 de la lectura anterior). Ambas acciones resuelven `clientId` mediante el perfil autenticado de Manager; para SUPER_ADMIN se conserva la selección de tenant validada por `resolveOperationalContext`. El identificador del navegador no llega al módulo de persistencia. Se exige service role para leer la tabla protegida por RLS y ejecutar las RPC semanales. `get` devuelve `{ok:true,action,rules,revision}`; `save` devuelve la misma forma con la revisión de la transacción de escritura (Fase 6B.1). Errores controlados: `WEEKLY_HOURS_INVALID` (400), `WEEKLY_HOURS_CONFLICT` (409), y errores de lectura o guardado (503). Ninguna de las dos acciones escribe SETTINGS, capacidades o flags. `saveSettings` y `capacity.save` no se reutilizan.

El adaptador valida exactamente las 21 combinaciones únicas, domingo=0, servicios de restaurante permitidos, horas en HH:mm o HH:mm:ss, inicio anterior al fin y horas `NULL` cuando el servicio está cerrado. La RPC inicial `replace_booking_service_hours(text,jsonb)` serializaba sustituciones por tenant con un advisory lock y revertía la transacción si fallaban sus constraints; la migración posterior de 6B.1 retira esta firma. El editor permanece tras `import.meta.env.DEV && VITE_WEEKLY_HOURS_UI=true`; carga los datos remotos, conserva un borrador local distinto para revisión explícita, bloquea guardados sin una lectura exitosa y muestra los fallos. Los servicios globalmente desactivados no son editables; sus reglas remotas permanecen. Guardar no activa `WEEKLY_HOURS_ENABLED` ni `ENABLE_WEEKLY_CREATE_GUARD`.

**Límite detectado en 6B:** la RPC de dos argumentos no aceptaba `expected_revision`; la comparación en Manager API y el reemplazo ocurrían en transacciones separadas. Dos escritores podían superar el control y sobrescribirse. La Fase 6B.1 siguiente prepara la corrección local. La tabla y RPC no constan como desplegadas en producción; sin ellas las acciones devolverán error y no deben presentarse como operativas. La activación semanal y la coordinación con API pública/RPC de reservas siguen pendientes.

**Validación local:** Deno 2.9.7 ejecutó 12/12 tests del borrador y del adaptador de Manager, con mocks de lectura, validación, conflicto, confirmación, aislamiento y normalización de hora. `npm run build` (TypeScript + Vite) pasó. PostgreSQL 16 local desechable `weekly_test` en `127.0.0.1:55499` aplicó el fixture, la migración versionada y `booking_service_hours_isolated.sql` con `ON_ERROR_STOP=1`. `weekly_hours_manager_persistence_isolated.sql` verificó lectura tras guardar, domingo, dos tenants, rechazo sin pérdida de reglas y marcadores de Settings/capacidad intactos; terminó con `ROLLBACK`. El Deno check completo de `manager-api/index.ts` reportó 23 errores tanto en una copia temporal del HEAD `bf7f524` como en Fase 6B; las firmas de diagnóstico coinciden y no se detectaron errores nuevos. La suite previa del motor/adaptador no pudo repetirse localmente sin acceso a `deno.land`; su CI histórico permanece documentado arriba. Este entorno no equivale a producción ni prueba una llamada HTTP real autenticada a Manager API. El filtro legacy de fin inclusivo en Booking y Assistant sigue pendiente de una fase posterior.

## Fase 6B.1: control atómico de revisión (local, sin commit ni despliegue)

La migración versionada `20261026120000_booking_service_hours_revision_cas.sql` retira la firma insegura `replace_booking_service_hours(text,jsonb)` y prepara `replace_booking_service_hours(text,jsonb,text) returns text`. El tercer argumento es la revisión esperada. La función adquiere el advisory lock exclusivo existente por `client_id`, obtiene la revisión actual, compara, valida y reemplaza las 21 reglas dentro de la misma transacción; si difiere, lanza `P0001 / WEEKLY_HOURS_CONFLICT` antes de escribir. Devuelve la nueva revisión. La lectura nueva `get_booking_service_hours_snapshot(text) returns jsonb` adquiere el lock compartido y devuelve `{rules, revision}` de una misma instantánea. Solo `service_role` puede ejecutar ambas RPC; la función interna de estado no tiene ejecución pública. La revisión de la configuración vacía es SHA-256 de la cadena vacía; para una configuración con filas, SHA-256 codifica la concatenación ordenada por `(weekday, service)` de cinco componentes por fila: `weekday|service|enabled(1/0)|start_time|end_time`. PostgreSQL normaliza las horas a `HH:mm:ss` y usa `-` para `NULL`. La lectura y la escritura usan la **misma función SQL** para obtenerla. No hay cálculo independiente en JavaScript.

Manager API invoca la RPC atómica directamente con `expected_revision`, sin lectura previa separada; traduce exclusivamente `P0001 / WEEKLY_HOURS_CONFLICT` a HTTP 409 y código público estable. Conserva el borrador local en conflicto. Los demás errores se distinguen entre validación y servidor sin exponer texto SQL inesperado. Los tests y consumidores de la antigua firma en el entorno aislado se adaptaron; `booking_service_hours_isolated.sql` sigue comprobando la migración inicial antes de aplicar CAS. El workflow incorpora pruebas de ambas migraciones, persistencia y dos escritores concurrentes en PostgreSQL efímero. El resultado del CI del commit de consolidación debe verificarse por separado.

**Pruebas locales ejecutadas:** PostgreSQL 16 desechable en `127.0.0.1:55501`: migración inicial y sus tests, nueva migración CAS, primer guardado, revisión coincidente, actualización, conflicto obsoleto, reintento, 21 filas, aislamiento de tenants y rollback de errores, todo PASS. Dos sesiones reales con la misma revisión y horarios distintos: primera escritura PASS, segunda `WEEKLY_HOURS_CONFLICT`, estado final igual al ganador y reintento con nueva revisión PASS. En la base separada `weekly_rpc_test` pasaron los fixtures, comparación legacy antes/después, suite SQL semanal y concurrencia de cupo/cierre/reserva con la nueva firma. Deno 2.9.7: 13/13 tests del adaptador de Manager y borrador PASS; `deno check` focalizado PASS; `npm run build` PASS. `deno check` completo de Manager API sigue con 23 errores heredados, igual que el HEAD `bf7f524`, sin nuevos diagnósticos en los módulos tocados. No se ejecutó un handler HTTP autenticado contra Supabase real ni se tocaron Settings, capacidades o flags reales. Las pruebas anteriores del motor/adaptador de disponibilidad siguen cubiertas por su CI histórico, pero no se repitieron localmente en esta fase.

## Fase 7C: preparación de integración segura (27/10/2026)

El preflight, la comparación local con el hotfix CORS v129, el dominio Preview fijo y el orden propuesto de integración se documentan en [WEEKLY_HOURS_PREDEPLOY.md](WEEKLY_HOURS_PREDEPLOY.md). Son preparativos de la rama; no se han aplicado migraciones, desplegado funciones ni activado reglas en producción.

## Compatibilidad del trigger de aforo de walk-ins (29/10/2026; solo local)

La migración local `20261029180000_weekly_walkin_capacity.sql` consulta `SETTINGS.WEEKLY_HOURS_ENABLED` para **cada** inserción `source_channel='walk_in'` de restaurante antes de decidir si continúa por LEGACY. Con `SETTINGS` legible y el flag ausente o falso, la inserción legacy conserva su comportamiento. Con un fallo de lectura, el trigger devuelve `WEEKLY_HOURS_CONFIG_READ_FAILED` incluso para LEGACY y no inserta la fila. Esta migración **no está lista para publicar** mientras se exija continuidad de los walk-ins legacy ante ese fallo.

Prueba aislada en PostgreSQL 16.15 (`weekly_walkin_test`, 127.0.0.1; transacción con `ROLLBACK`): con `SETTINGS` temporalmente inaccesible, el walk-in ficticio LEGACY se insertó al deshabilitar solo el trigger nuevo; con el trigger habilitado fue rechazado sin escritura. El walk-in WEEKLY también fue rechazado sin escritura. Las suites `weekly_reservation_rpc_legacy_comparison.sql`, `weekly_walkin_capacity_isolated.sql` y `weekly_reservation_rpc_isolated.sql` pasaron con `SETTINGS` disponible. Tres carreras reales de último cupo (walk-in/walk-in y público/walk-in en ambos órdenes) guardaron una sola reserva de dos plazas y rechazaron la otra.

No existe una decisión segura dentro del trigger actual cuando no puede leer el flag: un tenant LEGACY y otro WEEKLY con reglas incompletas pueden ser indistinguibles. La presencia de filas en `booking_service_hours` tampoco demuestra activación, porque se pueden preparar las 21 reglas con WEEKLY apagado; la ausencia de filas no demuestra LEGACY. Permitir la inserción tras el error abriría un bypass para WEEKLY. Por esta razón no se introdujo un fallback ni se cambió la lógica SQL. La RPC pública ya consulta `SETTINGS` por su cuenta; el riesgo adicional de esta migración recae en el camino directo de walk-ins de Manager.

**Pendiente independiente: reservas manuales.** `manager-api` las inserta directamente después de su guard previo. No comparten todavía un control transaccional de aforo con la RPC pública y el trigger de walk-ins. Esta revisión no modifica ese camino ni lo presenta como protegido. La activación de WEEKLY y la publicación de la migración requieren resolver y probar por separado tanto el fallo de lectura de `SETTINGS` como esa protección manual.

## Integración final en curso (30/10/2026; desarrollo publicado, activación pendiente)

La única fuente operativa de horarios de restaurante en modo WEEKLY son las 21 reglas de `booking_service_hours`. `SERVICES_ENABLED` controla si cada servicio se ofrece globalmente; Balinesa mantiene su configuración independiente. Settings oculta los antiguos horarios generales, horarios de servicio y días globales en la superficie nueva. Su resumen agrupa los turnos derivados de las 21 reglas y no muestra un borrador como configuración guardada. El intervalo de reservas y las capacidades siguen siendo controles separados; un horario abierto no crea cupo.

Manager determina el modo desde `settings.get` del tenant autenticado. Solo usa HOY y el formulario semanal cuando el flag verificado está activo; si el modo no se pudo verificar, bloquea nuevas creaciones desde el frontend. El guard del servidor consulta el modo y las reglas antes de cualquier escritura, sin confiar en el origen HTTP ni en el navegador. La validación semanal de walk-ins usa la hora actual de Europe/Madrid. El margen anticipado de 15 minutos permanece desactivado durante esta primera integración: un walk-in a las 17:50 no entra en CENA si empieza a las 18:00. Las reservas existentes de servicios cerrados continúan visibles.

La migración local `20261029180000_weekly_walkin_capacity.sql` ahora imputa también `manager_manual` a `capacity_slot_time`, conserva `booking_time` como hora real, toma el bloqueo del tenant antes de leer el flag y comparte el bloqueo de franja con la RPC pública. Para tenants LEGACY legibles, la inserción continúa por el camino anterior. Un fallo al leer SETTINGS sigue rechazando las inserciones internas de restaurante: no existe una forma segura de distinguir LEGACY de WEEKLY activo sin conocer el flag. Es un riesgo de disponibilidad, no una autorización para abrir el camino de escritura. No se ha aplicado la migración ni activado WEEKLY.

Widget conserva la selección de servicio y hora y respeta `availability_mode=WEEKLY` emitido por Public API. Assistant aplica el mismo criterio en su flujo de mesa; con `LEGACY` o campo ausente conserva el filtro anterior. Ninguno de los dos cambia la creación ni el flujo de Balinesa. Los tests SQL ampliados de aforo interno y concurrencia están preparados para PostgreSQL 16 desechable en CI; no se declaran PASS hasta ejecutarse allí.

El commit de desarrollo `79a5a312` pasó el workflow aislado [#41019963940](https://github.com/COSTABOTS/MANAGER/actions/runs/41019963940), incluidas las suites SQL y la concurrencia real de último cupo en PostgreSQL 16. Ese resultado valida el código de la rama, no implica que la migración nueva o el guard semanal estén instalados o activos en Supabase. El frontend Manager y Assistant aún requieren la publicación de sus cambios correspondientes.

En el ajuste local posterior, Settings mantiene el intervalo editable y oculta los antiguos campos editables de apertura, cierre y días generales. En modo WEEKLY, un cambio de intervalo o de capacidad total ya no genera franjas desde `serviceHours` legacy: `capacity.save` solo recibe franjas de servicio previamente configuradas, incluidos los ceros explícitos. Si no existen franjas, el editor lo indica y no inventa capacidad 20. El modo LEGACY conserva su generación anterior. El build de Manager y 55 tests puros del frontend pasaron localmente; este ajuste posterior todavía no está publicado ni cubierto por CI.
