# Despliegue y control de origen

1. Confirmar repositorio, remote, rama, commit y estado limpio (o documentar cambios previos).
2. Comparar diff y verificar que la fuente contiene la ruta que se va a publicar.
3. Ejecutar checks locales relevantes.
4. Desplegar una sola función explícita; nunca usar un checkout descargado de producción sin comparar con `HEAD`.
5. Ejecutar smoke tests por tenant y canal.
6. Registrar versión, timestamp, respuesta y rollback.

No se deben desplegar cambios de Booking para reparar Assistant ni viceversa. Vercel/DNS y proyectos exactos siguen PENDIENTE salvo las URLs HTTP verificadas en el inventario.

## Reparación verificada del 14/10/2026

Fuente: `COSTABOTS/MANAGER`, commit completo `ad2c21845f39ef3dcde6162c4d110d6995c84c30`, rama `docs-production-audit` derivada de `main` para documentación. Se empaquetó `supabase/functions/public-api` junto con `supabase/functions/_shared` y se ejecutó un despliegue explícito de `public-api` al proyecto `tbmkbzpdixoeucvvofjp`. La función quedó en versión observada 84. El número de versión es evidencia del listado Supabase, no un sustituto del commit fuente.

El despliegue inicial falló porque faltaba `_shared/reservation-store`; el segundo paquete incluyó ese directorio y fue aceptado. Smoke posterior: `zacs-assistant`, `zacs`, `granditalia` y `safari` resolvieron correctamente.
