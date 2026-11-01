# Instrucciones de desarrollo — COSTABOTS/MANAGER

Este repositorio contiene el frontend de Manager, Edge Functions de Hospitality, módulos compartidos de reservas y migraciones. Estas reglas protegen la operativa existente; los detalles de rutas, contratos y despliegues deben comprobarse en el código y en el entorno correspondiente antes de usarlos.

## Inicio y alcance del trabajo

- Comprobar `git remote -v`, rama, HEAD, `git status --short` y el diff relevante antes de editar. Conservar todos los cambios locales preexistentes: no ejecutar `reset`, `clean`, `stash` ni sobrescribirlos automáticamente.
- Una solicitud explícita para modificar una funcionalidad autoriza los cambios locales y pruebas necesarios dentro de ese alcance, pero no autoriza despliegues ni operaciones sobre producción. No pedir permiso por cada edición menor. Solicitar autorización antes de ampliar el alcance o ejecutar operaciones destructivas.
- Trabajar con cambios mínimos, reversibles y verificables. No eliminar funcionalidades ni simplificar validaciones únicamente para hacer pasar TypeScript, tests o CI.
- Usar el código versionado como base de desarrollo. Las fuentes descargadas de una función activa sirven para verificar compatibilidad y recuperación; no asumir que coinciden con `main` ni sustituir módulos enteros sin comparar el diff.
- No modificar otros repositorios de COSTABOTS (Assistant, Booking, Admin, Beauty/AURA u otros) salvo que la tarea los incluya expresamente.

## Mapa actual del repositorio

- `src/pages/Settings.tsx`, `src/pages/WeeklyHoursEditor.tsx`, `src/pages/Today.tsx`, `src/pages/Reservations.tsx`, `src/components/WalkInForm.tsx` y `src/services/` cubren configuración, horarios, capacidad, reservas, walk-ins y llamadas a Manager API. Verificar estas rutas si cambia la estructura.
- `supabase/functions/manager-api/` autentica y resuelve el tenant para acciones administrativas, incluidas reservas internas y horarios. `supabase/functions/public-api/` sirve configuración, disponibilidad y reservas públicas.
- `supabase/functions/_shared/reservation-store/` contiene contratos y stores Supabase/Sheets. En las ramas que lo incorporen, `_shared/booking-hours/` contiene reglas semanales. `supabase/migrations/` contiene SQL versionado; usar `supabase/tests/` cuando exista en la rama. Una migración versionada no demuestra que esté aplicada remotamente.

## Invariantes de reservas y configuración

- No alterar sin autorización las reglas de disponibilidad, reservas, cierres, horarios, servicios o capacidad. Mantener coherentes reservas web, reservas manuales y walk-ins, y comprobar rechazos sin escrituras.
- Al trabajar en el modelo semanal, verificar en el código y esquema de la rama que `SERVICES_ENABLED` controla la habilitación global, `booking_service_hours` define días e intervalos por servicio y la capacidad sigue siendo independiente. No convertir horarios generales derivados en otra fuente operativa. Comprobar en el contrato vigente la cardinalidad de reglas, los límites horarios y la convención de weekday; no mezclarla con la de capacidad legacy.
- Preservar LEGACY cuando el modo semanal no esté activo conforme al contrato vigente. Si el modo no puede determinarse con seguridad, no introducir un fallback que permita eludir una restricción semanal. Mantener BALINESA y su configuración de piscina independientes de las franjas de restaurante.
- No confiar en parámetros del navegador ni en `Origin` para autorizar un tenant, activar un modo o validar una reserva. CORS no sustituye la autenticación, la autorización ni el aislamiento por tenant del servidor. Mantener autenticación y perfil, aislamiento por `client_id`, permisos, RLS y validaciones autoritativas del servidor. Revisar también los caminos de escritura directos y las RPC cuando corresponda.
- Conservar los mecanismos existentes de revisión CAS, locks, concurrencia, idempotencia, capacidad y bloqueos. No permitir que un cambio de horario o capacidad entre lectura y escritura produzca una reserva fuera de las reglas aplicables.
- Separar datos DEMO, Preview y producción. No activar flags, horarios o guardados remotos por efecto de una prueba o un cambio visual. No imprimir secretos, tokens ni datos personales; no crear reservas reales para smoke tests.

## Validación y comunicación

- Ejecutar las comprobaciones que correspondan al cambio. El `package.json` actual ofrece `npm run build` (TypeScript y Vite), pero no un script `npm test`; verificarlo de nuevo si cambia. Para Edge Functions, localizar y ejecutar los `deno check` y `deno test` pertinentes; si la rama incluye `.github/workflows/weekly-service-hours.yml`, seguir sus comandos aplicables. Ejecutar pruebas SQL solo en PostgreSQL desechable con los fixtures y guards disponibles; revisar `git diff --check`.
- Mantener la interfaz responsive y comprobar especialmente la usabilidad móvil cuando cambie frontend.
- No afirmar PASS sin ejecución. Informar de pruebas omitidas, errores conocidos, diferencias frente a versiones activas y riesgos pendientes. Marcar como PENDIENTE todo dato no verificado.

## Publicación y recuperación

- No hacer push, merge, despliegues, migraciones remotas, cambios de secretos o variables, ni aplicar cambios de RLS o configuración de Supabase remoto sin autorización explícita. Respetar también cualquier restricción específica de la tarea, incluida una prohibición de commit local.
- Antes de un despliegue autorizado: identificar proyecto, función, rama y commit; comparar con la versión activa verificada; revisar diff, imports compartidos, autenticación y CORS; ejecutar checks y pruebas aplicables; preparar una copia recuperable y un plan de rollback. No usar artefactos de otra versión como recuperación supuesta.
- Después: verificar versión y estado, ejecutar smoke tests no destructivos por tenant en Manager y, si el cambio afecta esos canales, Assistant y Booking; comprobar configuración y disponibilidad pertinentes. Registrar identificadores de petición cuando estén disponibles sin exponer datos privados. Ante una regresión, seguir el rollback autorizado y documentar el resultado.
