# Incidente 2026-10-14

## Cronología

- Public API empezó a devolver `503 LEGACY_SHEETS_DISABLED`.
- Se confirmó que Assistant, Booking y operaciones dependientes compartían la función.
- Se restauró `ENABLE_LEGACY_SHEETS=true`.
- La versión desplegada seguía siendo heredada y no contenía rutas `/widget/*`, provocando `405 METHOD_NOT_ALLOWED`.
- Se desplegó únicamente `public-api` desde el `HEAD` verificado de `COSTABOTS/MANAGER`.
- Smoke tests: `zacs-assistant`, `zacs`, `granditalia` y `safari` resolvieron correctamente; tokens no se documentan.

## Causa

Combinación de guard de configuración y despliegue desde una fuente/versionado incorrectos. No fue causado por los themes de Booking.

## Lecciones

Verificar siempre origen, commit, rutas presentes y versión desplegada antes de publicar. Un nombre como `ENABLE_LEGACY_SHEETS` describe un guard global, no una migración automática.
