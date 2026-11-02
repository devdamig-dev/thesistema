# GastroPilot — instrucciones para Claude Code

Leer y aplicar el contrato íntegro de `AGENTS.md`, el contexto de `PROJECT_CONTEXT.md` y el gate `QUALITY_GATE.md`. Adaptar toda implementación al stack real (Next.js/React/TypeScript/Supabase) y al CI existente.

Antes de desarrollar: inspección focalizada, criterios de aceptación y verificación de usuarios, negocio, roles y persistencia. Priorizar seguridad, datos, cobros/stock y onboarding. No producir demos o IA/WhatsApp simulados como funcionalidad real. Después de corregir un fallo, agregar regresión y ejecutar los tests adecuados.

Las Skills de ingeniería de NexoDG están disponibles como archivos de referencia en `.agents/skills/`. En Claude Code leer la relevante explícitamente; no asumir autodescubrimiento del directorio de Codex.

Informar IMPLEMENTADO, PROBADO, DESPLEGADO y VALIDADO EN PRODUCCIÓN por separado, con evidencia, errores pendientes y riesgos de migración/rollback. No modificar producción sin autorización aplicable.
