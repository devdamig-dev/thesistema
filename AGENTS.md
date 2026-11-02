# GastroPilot AI — contrato de ingeniería NexoDG

Aplicar **NexoDG Engineering Standards v1.0**. Leer `PROJECT_CONTEXT.md`, `QUALITY_GATE.md` y `docs/ENGINEERING_STANDARDS_ADOPTION.md` antes de implementar. Este repositorio es **GastroPilot AI** (`devdamig-dev/thesistema`), no Nexo Core ni Gongo.

## Principios obligatorios
1. Inspeccionar primero la arquitectura y el módulo afectado. Definir flujo y resultado verificable; no rehacer funcionalidades existentes ni aceptar interfaces aparentes como terminadas.
2. Implementar flujo completo cuando corresponda: UI, servidor, Supabase, validaciones, autorización y estados de error, con datos persistidos.
3. SaaS multiempresa: comprobar políticas RLS, organización, rol y alcance por sucursal/negocio en API/SQL, no solo filtros de UI. Secretos siempre del lado servidor.
4. Operaciones de ventas, pedidos, compras, caja, stock y deudas requieren precisión, idempotencia o control de concurrencia cuando aplique; proteger movimientos ya registrados.
5. WhatsApp, IA y fuentes de lectura pasiva deben reflejar permisos y estado REAL de proveedores; no inventar canales, chats, grupos o respuestas conectadas. No ejecutar escrituras o herramientas de IA desde una fuente configurada solo para lectura.
6. Antes de cada PR, ejecutar los controles pertinentes de `.github/workflows/quality.yml` y pruebas afectadas (no dar por aprobadas las no ejecutadas). Agregar regresión para bugs corregidos.
7. Probar onboarding, sesión, invitaciones, usuarios, roles, aislamiento de empresas/sucursales y móvil según riesgo.
8. Preservar el comportamiento existente; cambios a producción requieren evaluación de migraciones, respaldo/rollback y autorización cuando afecten datos o usuarios reales.
9. Informar estados distintos: IMPLEMENTADO, PROBADO, DESPLEGADO y VALIDADO EN PRODUCCIÓN con evidencia. No afirmar deploy o QA en producción sin ejecutarlo.
10. Landings: beneficio y transformación en hero, look and feel, copys y motion; funcionalidades reales en un segundo nivel explicativo.

## Skills de desarrollo
Leer la Skill pertinente de `.agents/skills/`: nexodg-feature-delivery, nexodg-debugging, nexodg-qa, nexodg-integrations, nexodg-release o nexodg-commercial-landing. Son guías de trabajo; no sustituyen las pruebas reales ni las reglas del código.
