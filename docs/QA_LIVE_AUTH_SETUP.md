# Activar QA autenticada multiempresa

Este documento prepara la ejecución **manual** de `.github/workflows/qa-live-auth.yml`, con dos sesiones reales de Supabase. El workflow realiza login con email/password y consultas GET restringidas por RLS. No escribe datos del negocio, pero el proceso de login genera una sesión Auth y trazas de autenticación.

## Requisitos antes de ejecutar
1. Tener dos **usuarios QA** con emails verificados, contraseñas de prueba únicas y controladas, y acceso autorizado a dos organizaciones **diferentes**. Nunca reutilizar credenciales de clientes.
2. Cada organización QA debe tener al menos un negocio creado mediante onboarding.
3. Guardar en **Settings → Secrets and variables → Actions → Repository secrets** estos cinco valores, sin compartirlos por chat:
   - `QA_PUBLIC_KEY`: clave pública (anon/publishable) del proyecto Supabase pertinente, **nunca** `service_role` ni `sb_secret_*`.
   - `QA_USER_A_EMAIL`: email de la primera identidad QA.
   - `QA_USER_A_PASSWORD`: contraseña de prueba de esa identidad.
   - `QA_USER_B_EMAIL`: email de la segunda identidad QA.
   - `QA_USER_B_PASSWORD`: contraseña de prueba de esa identidad.
4. El workflow solo se ejecuta con **Actions → E2E QA Auth real y lectura multiempresa → Run workflow**, después de integrar este PR a `main`. En pull requests solo se ejecuta `node --check`, sin acceder a secretos ni enviar solicitudes reales.
5. **Antes de la ejecución manual en GastroPilot:** el repo actualmente tiene como rama predeterminada una rama antigua de Claude. Cambiar la rama predeterminada a `main` desde **Settings → General → Default branch**, después de revisar que Vercel y los PR activos apuntan a `main`. Los workflows `workflow_dispatch` necesitan existir en la rama predeterminada para estar disponibles.

## Criterios de aceptación
- Dos logins de Auth reales y dos identidades diferentes.
- Cada usuario ve su(s) organización(es) y al menos un negocio/departamento de prueba.
- No hay organizaciones compartidas entre ambos usuarios QA.
- Cada usuario obtiene **cero filas** al consultar explícitamente organizaciones y negocios/departamentos del otro tenant.
- La ejecución no imprime emails, contraseñas, JWTs, nombres de clientes ni filas devueltas.

## Qué NO demuestra
- No prueba navegación de formularios en navegador, aceptación de invitaciones, envío de emails, escritura multiempresa, stock, cobros, WhatsApp/Meta, IA o permisos entre departamentos. Es un gate **real de autenticación y RLS de lectura**, no autorización de onboarding general.

## Manejo de fallos
Ante secretos faltantes, login no válido, dos usuarios en la misma organización, ausencia de negocio/departamento o un RLS que permita acceso cruzado, el job **falla**. No marcar como aprobado un job omitido en PR. Usar el mensaje del job para diagnosticar sin publicar credenciales.
