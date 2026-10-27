# Horario de piscina de Balinesa — Fase 7A

## Estado y alcance

**Preparado localmente, sin migración ejecutada ni API desplegada.** El editor Preview continúa guardando únicamente en `localStorage`; no llama a `poolHours.get` ni a `poolHours.save`. La nueva configuración no participa todavía en disponibilidad ni en creación. Su ausencia no establece horario alguno ni bloquea reservas legacy.

**Contrato funcional confirmado:** Balinesa se reserva por **fecha**, sin selección de hora en Widget ni Assistant. El horario de piscina es una configuración operativa y un corte para reservas **del mismo día**; no define turnos, franjas reservables ni capacidad. Mostrar apertura/cierre al cliente es opcional e informativo. Ningún valor de hora de piscina debe incorporarse como opción de reserva o alterar la fecha elegida.

Fuente de desarrollo: rama `feature/weekly-hours-availability`, base `481424ef974d476986197cb7d5d22a0ef7783e95`. Esta fase no altera `public-api`, las RPC de reservas, Widget, Assistant, Settings legacy, capacidades ni datos reales.

## Decisión de almacenamiento

Se propone `public.booking_pool_hours` con una fila por `client_id`. `SETTINGS` almacena actualmente `SERVICES_ENABLED` y su guardado puede ejecutar aprovisionamiento de capacidad de CENA. Es preferible una operación independiente, para evitar ese efecto al guardar la piscina. `reservable_resources` representa unidades reservables y capacidad, no el horario común de piscina. Las 21 reglas de `booking_service_hours` pertenecen a DESAYUNO, ALMUERZO y CENA; Balinesa sigue fuera de ellas. Guardar `booking_pool_hours` no crea ni modifica franjas o recursos.

La fila contiene `opening_time`, `closing_time`, `time_zone='Europe/Madrid'`, `revision` UUID y marcas de creación/actualización. `opening_time < closing_time`; se aceptan horas `HH:mm`, sin tramos que crucen medianoche. `SERVICES_ENABLED` sigue siendo la única autoridad del estado general de Balinesa; la tabla nueva no tiene un segundo interruptor. La zona se fija explícitamente para esta primera versión; antes de admitir tenants en otra zona habrá que diseñar su migración.

## Migración y permisos

`supabase/migrations/20261027120000_booking_pool_hours.sql` prepara la tabla con FK a `CLIENTES.client_id`, PK por tenant, checks de horas y zona, RLS y permisos de tabla para `service_role`. Las RPC `get_booking_pool_hours_snapshot(text)` y `replace_booking_pool_hours(text,text,text,text)` son `SECURITY DEFINER`, con `search_path` explícito, y revocan ejecución a `PUBLIC`, `anon` y `authenticated`. El Manager API deriva el tenant de la sesión autenticada y llama a esas RPC con service role. Una llamada directa privilegiada al RPC sigue pudiendo seleccionar cualquier `client_id`; la clave service role debe permanecer exclusivamente en servidor.

El guardado toma un advisory lock por tenant, lee la revisión dentro de la misma transacción, compara `expected_revision` y escribe de forma atómica. La primera escritura exige `expected_revision: null`. Cada actualización válida cambia la revisión; una revisión obsoleta devuelve `POOL_HOURS_CONFLICT` sin escribir. El snapshot no configurado devuelve `configured: false`, horas y revisión nulas. La migración es repetible como definición, pero **no se ha probado en el esquema real** y no debe ejecutarse hasta la validación aislada y la revisión de dependencias.

## Contrato preparado de Manager API

Se añaden las acciones autenticadas `poolHours.get` y `poolHours.save` al endpoint existente de Manager:

```json
{"action":"poolHours.get"}
{"action":"poolHours.save","opening_time":"10:00","closing_time":"19:00","expected_revision":null}
```

Respuesta correcta: `{ "ok": true, "action": "poolHours.get", "configured": false, "opening_time": null, "closing_time": null, "time_zone": "Europe/Madrid", "revision": null }` o el mismo formato con horas y revisión al estar configurado. El `client_id` de la petición se ignora; se usa el tenant del contexto autenticado. Errores controlados: `POOL_HOURS_INVALID` (400), `POOL_HOURS_CONFLICT` (409), errores de lectura/guardado/configuración (503). No se envían detalles internos SQL en la respuesta pública. La Preview no consume estas acciones todavía.

## Corte de reservas: diseño de la siguiente fase

La función pura `src/utils/balinesePoolPreview.ts:evaluateBalinesePoolCutoff` ya compara **solo la fecha de reserva** y el instante actual en `Europe/Madrid`, permite hoy solo antes del cierre exacto y deja pasar fechas futuras a las comprobaciones normales. No recibe ni genera una hora de reserva. Devuelve `INVALID_SCHEDULE` para una hora local de cierre inexistente o ambigua en cambios DST. `ALLOWED_BY_CUTOFF` **no** significa que haya capacidad. Para integrarla en servidor debe trasladarse a un módulo compartido de runtime y aplicarse en **disponibilidad y creación**, antes de Supabase o Sheets; el origen del horario debe ser `booking_pool_hours` del tenant validado, nunca un valor enviado por el navegador. Un fallo de lectura con la restricción activada debe fallar cerrado.

El endpoint actual `public-api/routes/reservationBalineseAvailability.ts` recibe fecha y personas y devuelve `available`/`available_count`, sin lista de horas; depende de Supabase y devuelve `BALINESE_AVAILABILITY_UNSUPPORTED` para Sheets. La creación en `reservationBalineseCreate.ts` sí tiene rutas Supabase y Sheets. Su payload normalizado contiene un campo interno `hora`, que **no debe convertirse en una selección de hora en Widget o Assistant**. Antes de activar el corte se debe verificar el origen y uso de ese campo para conservar compatibilidad. La RPC versionada `create_hospitality_balinese_reservation` no conoce el horario de piscina: una llamada privilegiada directa podría eludir una validación puesta solo en API. La fase de activación debe decidir el control transaccional en RPC para Supabase y la validación previa al append para Sheets. Debe preservar idempotencia, bloqueos, capacidad, recursos y reservas existentes. No se debe activar restricción para tenants sin horario válido.

## Validación

El workflow de horarios se amplía para ejecutar los tests Deno de `poolHoursActions.test.ts` y aplicar la migración con aserciones SQL y prueba de concurrencia **solo** en PostgreSQL 16 efímero `weekly_test`. Los scripts SQL comprueban identidad de la base antes de operar. No se usan credenciales de Supabase real. Los resultados locales y de CI deben registrarse por separado; este documento no declara PASS los pasos SQL hasta que se ejecuten.

Validación local del 27/10/2026: Deno 2.9.7, check focalizado PASS, 22/22 tests seleccionados PASS, `npm run build` PASS y `git diff --check` PASS. `deno check` completo de `manager-api/index.ts` encontró 23 diagnósticos; una extracción temporal del commit base `481424ef` produjo los mismos 23, sin diagnósticos nuevos en esta fase. PostgreSQL/psql y Docker no estaban disponibles localmente: migración, aserciones SQL y concurrencia real quedan pendientes de CI aislado. Un test de acceso simulado no sustituye una prueba HTTP autenticada completa.

Matriz pendiente antes de activación: dos restaurantes aislados; get/save autorizados y acceso cruzado rechazado; primera escritura, revisión vigente y obsoleta, dos ediciones concurrentes; horas inválidas y cruce de medianoche; cierre exacto y cambio CET/CEST; servicio desactivado; error de lectura; Supabase y Sheets; **misma oferta por fecha en Widget y Assistant, sin selector ni franjas horarias**; cero cambios en `SETTINGS`, capacidades, reservas y las 21 reglas semanales. También se requieren pruebas del handler HTTP completo con autenticación real simulada y de la futura API pública, incluyendo rechazo del día actual al cierre tanto en disponibilidad como en creación y fecha futura sujeta a capacidad normal.

## Activación y recuperación posterior

1. Validar migración, permisos y concurrencia en PostgreSQL desechable y revisar equivalencia con el esquema actual antes de considerar un despliegue.
2. Desplegar esquema y acciones Manager sin conectar aún la Preview ni activar el corte. Confirmar que las reservas legacy conservan su comportamiento.
3. Con autorización separada, conectar la interfaz a lectura/guardado remoto con control de revisión y preparar datos por tenant. No inventar horarios por defecto.
4. Con otra autorización, proteger disponibilidad y creación en ambos stores y cerrar el bypass de RPC, con flag desactivado por defecto, pruebas por canal y smoke tests sin reservas reales.

Rollback seguro: mientras no haya activación, revertir el código Manager API a su versión anterior deja la tabla inerte. Después de activar, apagar primero el control nuevo conforme a un procedimiento probado y recuperar el código anterior. El script manual `supabase/rollbacks/20261027120000_booking_pool_hours.sql` exige un marcador de sesión explícito y se niega a borrar una tabla con datos; solo sirve tras comprobar que no quedan consumidores y que la tabla está vacía. Si contiene horarios, conservarla o exportar/verificar los datos antes de diseñar una reversión de esquema. No cambiar `SERVICES_ENABLED`, capacidades ni flags legacy como sustituto del rollback.
