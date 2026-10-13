# COSTABOTS Hospitality — inventario de producción

Fecha de auditoría: 2026-10-14. Estado: solo lectura.

## Repositorios verificados

| Sistema | Repositorio | Rama/commit observado | Verificación |
|---|---|---|---|
| Backend, Edge Functions y Manager | `COSTABOTS/MANAGER` | `main` / `ad2c218` | remoto y checkout verificados |
| Assistant | `COSTABOTS/costabots-assistant` | `main` / `11b1405` | checkout local verificado |
| Booking | `COSTABOTS/costabots-booking` | `main` / `bc80726` | checkout local verificado |
| Web pública | `COSTABOTS/costabots.github.io` | `main` / `b8f4fb3` | checkout local verificado |

La copia de MANAGER tiene cambios locales de inspección previos. No se limpiaron ni se consideran evidencia de producción.

## Supabase

- Proyecto: `tbmkbzpdixoeucvvofjp`.
- Edge Functions observadas: `public-api` (versión 84 tras la reparación), `manager-api` (127), `get-tables-test` (8), `reservation-sync` (9).
- `verify_jwt=false` está configurado para las funciones observadas.
- Fuente autorizada: `COSTABOTS/MANAGER/supabase/functions`.

## Dominios observados

Verificados por HTTP: `booking.costabots.com`, `manager.costabots.com`, `admin.costabots.com`.
`assistant.costabots.com` no resolvió DNS durante la auditoría: PENDIENTE.
`costabots.com` aparece como web pública en el checkout; hosting/DNS exactos: PENDIENTE.

## Sistemas pendientes de confirmar

Typebot, proyectos Vercel concretos, Experience, URLs por tenant, configuración DNS, workflows de WhatsApp y repositorios AURA/Beauty no quedaron verificados desde este entorno. No asumir que coinciden con los sistemas Hospitality.

## Matriz de smoke tests

| Tenant | Assistant | Widget | Typebot | Manager | Experience |
|---|---|---|---|---|---|
| Safari | resolver verificado | resolver verificado | PENDIENTE | HTTP shell verificada; API PENDIENTE | PENDIENTE |
| Grand Italia | PENDIENTE | resolver verificado | PENDIENTE | HTTP shell verificada; API PENDIENTE | PENDIENTE |
| Bruma/demo | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| ZACS | resolver verificado | resolver verificado | PENDIENTE | HTTP shell verificada; API PENDIENTE | PENDIENTE |

“Verificado” aquí significa smoke HTTP de resolución/configuración, no una reserva real ni una prueba de UI completa.
