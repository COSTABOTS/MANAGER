# Manager API v130 con acciones de horarios: paquete aislado

Estado: **preparado y probado localmente; no desplegado**. Proyecto previsto: `tbmkbzpdixoeucvvofjp`. No activar escrituras ni modificar la configuración remota en esta fase.

## Procedencia y contenido

La descarga de la función activa `manager-api` v130 se realizó mediante Supabase CLI y se comprobó con la misma versión, estado `ACTIVE`, `verify_jwt=false` y deployment hash `ca6aa632be1e3d09f12c45774f8384f8ae8bfaab22e09a252810991d366e933c` antes y después. La descarga se usa **solo como evidencia**, nunca como fuente de despliegue.

`scripts/prepare_manager_api_v130_hours.py` reconstruye v130 desde el commit Git `ad2c21845f39ef3dcde6162c4d110d6995c84c30`, añadiendo sus dos orígenes CORS verificados. Comprueba SHA-256 del contenido normalizado de los seis archivos runtime descargados. Después toma del commit `83499d15cbb330936b4be7a520e8b80412936158` exclusivamente `manager-api/index.ts`, `cors.ts`, `hoursWriteGate.ts`, `weeklyHoursActions.ts`, `weeklyHoursHttp.ts`, `poolHoursActions.ts` y `poolHoursHttp.ts`.

La fuente candidata tiene 13 archivos, incluyendo `types.ts` para el typecheck. Los ZIP deterministas incluyen `supabase/functions/manager-api` y `supabase/functions/_shared/reservation-store`. No incluyen `public-api`, migraciones, tests, `booking-hours`, datos, configuración ni secretos. El `manifest.json` de cada generación registra hashes y procedencia. El script falla si cambia un hash v130, falta un import, desaparece una acción anterior o cambia la semántica legacy de domingo.

## Diferencia contra los seis archivos runtime de v130

| Archivo | Candidato |
| --- | --- |
| `_shared/reservation-store/errors.ts` | Idéntico a v130. No incorpora nuevos códigos de creación. |
| `_shared/reservation-store/resolver.ts` | Idéntico a v130. |
| `_shared/reservation-store/sheetsReservationStore.ts` | Idéntico a v130. |
| `_shared/reservation-store/supabaseReservationStore.ts` | Idéntico a v130: domingo legacy=7, sin consulta nueva a `SETTINGS` ni filtro semanal. |
| `manager-api/reservationListSource.ts` | Idéntico a v130. |
| `manager-api/index.ts` | Conserva las acciones anteriores y añade solo `weeklyHours.get/save` y `poolHours.get/save`, sus imports y rutas. Extrae el mismo CORS a `cors.ts`; para las acciones nuevas devuelve 401 ante JWT ausente/inválido y protege `save` en servidor. |

La rama general mantiene cambios anticipados de disponibilidad y creación en `_shared`; **este paquete no los incluye**. El resto de las acciones Manager conserva sus handlers de v130. La comparación de casos `switch` no encontró ninguna acción eliminada.

## Guard de escritura y autenticación

La función resuelve JWT, perfil activo y `client_id` en servidor. Para un perfil `SUPER_ADMIN`, la selección de tenant solicitada por el navegador se valida dentro de `resolveOperationalContext`; los handlers reciben solo el tenant resuelto. Ambos `save` requieren perfil `ADMIN` o `SUPER_ADMIN`, `service_role`, `ENABLE_MANAGER_HOURS_WRITES=true` literal y coincidencia exacta del tenant en `MANAGER_HOURS_WRITE_CLIENT_IDS`. Sin esos dos valores de servidor, devuelven HTTP 403 antes de crear acceso a la base. `Origin` y `REMOTE_HOURS_PREVIEW_ENABLED` no autorizan escrituras. El flag de Preview permanece `false`; el frontend sigue usando borradores locales.

Las acciones de lectura y guardado usan exclusivamente las RPC de horarios ya instaladas; no escriben `SETTINGS`, `SERVICES_ENABLED`, `WEEKLY_HOURS_ENABLED`, capacidades ni reservas. El guardado usa la revisión CAS; el conflicto devuelve 409. No se ha probado una lectura autenticada real de las nuevas acciones en la función desplegada, porque este paquete no se ha desplegado.

## Validación local de esta fase

- ZIP candidato SHA-256: `B968DD702A6EBB4B0F26AAAC0120D0D9F3A211C82ADB1E29359B173B02A959B5`.
- ZIP recuperación v130 SHA-256: `C3B76B1CD75EE7F3B533E34411EE0D21D32897B5562D5B2D447D566E11356422`.
- Tests ejecutados contra el store del paquete: domingo con capacidad legacy `weekday=7` y `weekday=NULL`, exclusión de `weekday=0`, lunes `weekday=1`, y ausencia de consulta `SETTINGS`: PASS. Tests legacy adicionales de disponibilidad, capacidad, Fully Booked y controles del día: PASS.
- Deno 2.9.7 generó bundles locales de recuperación (17 módulos) y candidato (23 módulos), sin arrancar servicios. El typecheck global conserva 24 diagnósticos heredados idénticos en ambos paquetes; los checks focalizados de los nuevos módulos pasaron. El bundle local no equivale a un deploy Supabase ni a una prueba de ejecución remota.
- Los tests de los nuevos handlers, guard, CORS y contratos frontend pasaron antes de preparar este paquete. Las pruebas de empaquetado de esta fase no hicieron llamadas ni escrituras a Supabase real.

## Procedimiento futuro, sujeto a nueva autorización

1. Reconstruir los paquetes con `python scripts/prepare_manager_api_v130_hours.py`; comprobar manifest, SHA-256, `git status`, proyecto, versión activa y `verify_jwt=false`. Detenerse ante cualquier deriva de v130 o fallo de tests.
2. Conservar ambos ZIP y directorios fuente fuera de Temp antes de un despliegue. La raíz de `--workdir` es el directorio **candidate** que contiene `supabase/functions`; no es la carpeta `manager-api`.
3. Solo tras autorización expresa, desplegar **únicamente** `manager-api` con Supabase CLI 2.120.0:

   ```powershell
   & "$env:TEMP\costabots-supabase-cli\supabase.exe" functions deploy manager-api --project-ref tbmkbzpdixoeucvvofjp --workdir "<raiz-candidate-verificada>" --use-api --no-verify-jwt
   ```

4. Verificar nueva versión `ACTIVE`, `verify_jwt=false`, CORS de Manager y Preview, acciones antiguas de solo lectura y las dos nuevas lecturas autenticadas. Con flags de escritura sin configurar, verificar `weeklyHours.save` y `poolHours.save` con payload inválido o guard cerrado solo si se dispone de una prueba no mutante autorizada; nunca usar datos reales para probar un guardado.
5. Ante regresión atribuible a la función, restaurar **solo** `manager-api` desde la raíz `recovery-v130` verificada, con el mismo comando y `--workdir "<raiz-recovery-v130-verificada>"`. Comprobar versión activa, CORS, JWT y rutas anteriores. La reconstrucción local coincide con v130, pero un rollback remoto aún no se ha ejecutado.

La CLI 2.120.0 no ofrece `functions deploy --dry-run`; el bundle Deno local y los hashes son la validación de empaquetado disponible sin desplegar. `--no-verify-jwt` reproduce el valor observado `false`; la autenticación JWT de la función permanece obligatoria en su código. No activar las escrituras de horarios ni el editor remoto durante este paso.
