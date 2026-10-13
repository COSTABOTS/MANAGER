# Reglas del repositorio COSTABOTS/MANAGER

Este repositorio contiene Manager y las Edge Functions de Hospitality. Antes de modificar o desplegar:

- verificar `git remote -v`, rama, commit y `git status --short`;
- usar como fuente autorizada este repositorio y no artefactos descargados de Supabase;
- no desplegar `public-api` o `manager-api` sin diff, checks y smoke tests;
- no tocar Assistant, Booking, Admin, Beauty/AURA o legacy desde este checkout;
- no imprimir secretos ni crear reservas reales;
- documentar cambios y cualquier dato no verificado como PENDIENTE.

Los cambios locales existentes no deben limpiarse automáticamente.

## Checklist predeploy/postdeploy

Predeploy: identificar remote/commit; revisar `git diff`; confirmar función y proyecto; comprobar imports compartidos; ejecutar tests/build aplicables; obtener autorización explícita.

Postdeploy: leer versión en Supabase; ejecutar smoke tests Assistant y Booking por tenant; comprobar config y una ruta de disponibilidad; registrar request IDs; no crear reservas reales.
