# Reglas operativas para Codex

- No asumir que un checkout es el repositorio autorizado: comprobar remote, rama y commit.
- No limpiar worktrees con cambios pendientes.
- No desplegar sin diff revisado, checks y smoke tests.
- No mostrar, copiar ni registrar secretos, tokens, teléfonos o datos personales.
- No crear reservas reales en validaciones.
- Separar Hospitality, Beauty/AURA y legacy.
- Documentar toda incertidumbre como PENDIENTE.
- Para cambios de producción, obtener autorización explícita y limitar el blast radius a una función/proyecto.
- La fuente desplegable de Edge Functions es `COSTABOTS/MANAGER`; una descarga desde Supabase sirve para inspección, nunca como fuente sin comparar con `HEAD`.
- `public-api` requiere empaquetar también `supabase/functions/_shared` cuando los imports lo exijan.
- Diferenciar siempre commit fuente, versión Supabase, alias Vercel y dominio; son identificadores distintos.
