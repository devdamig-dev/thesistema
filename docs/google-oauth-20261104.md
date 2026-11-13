# Google OAuth · estado al 4 de noviembre de 2026 (Argentina)

Objetivo autorizado: acceso Google propio de GastroPilot, Waneia y Gongo, sin modificar Calore ni activar servicios pagos. Este repositorio corresponde exclusivamente a GastroPilot.

## Arquitectura inspeccionada

- GitHub `devdamig-dev/thesistema`, main base `d4f247a4fd712576341d17243e32fa174cce40ea`.
- Vercel `thesistema`, dominios `gastropilot.nexodg.com` y `thesistema.vercel.app`.
- Supabase `tcgcgrftnsuhorssjojk`, activo, modo `database` confirmado en Vercel.
- Auth SSR existente con PKCE y retorno `/api/auth/callback`; membresías y onboarding existentes se conservan.

## Configuración externa

Se creó Google Cloud `nexodg-gastropilot-auth`, número 474269809932. No se crearon todavía la marca, el cliente ni el secreto. Google exige aceptar la Política de Datos del Usuario de los Servicios de las APIs de Google; esa aceptación quedó pendiente. No se activó facturación ni servicios pagos. Calore no fue modificado. Browser dejó de responder durante la preparación de las otras aplicaciones.

Configuración planificada para el cliente Web:

- Orígenes: `https://gastropilot.nexodg.com` y `https://thesistema.vercel.app`.
- Callback en Google: `https://tcgcgrftnsuhorssjojk.supabase.co/auth/v1/callback`.
- Scopes: únicamente `openid`, `email`, `profile`.
- Client ID/Secret: proveedor Google integrado de Supabase; nunca variables públicas ni Git.
- Leer y preservar la configuración Auth existente antes de agregar retornos `https://gastropilot.nexodg.com/api/auth/callback` y `https://thesistema.vercel.app/api/auth/callback` con parámetros permitidos según matcher de Supabase. Verificar la allowlist antes de activar.
- Activar `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` en Vercel solo después de configurar y comprobar Google. La rama mantiene el botón oculto si esa variable no está habilitada; no se cambió Vercel todavía.

## Cambios de aplicación

Botón Google en registro/acceso; PKCE retorna al servidor sobre el mismo origen, sin transportar tokens de sesión en el fragmento. El servidor canjea el código y conserva no-store. Destinos externos se descartan. Cancelación/error vuelve al login con mensaje genérico sin reflejar detalles de Google.

Si el acceso se originó en una invitación, el retorno mantiene `invite_token` y `next` para que el usuario acepte mediante la lógica actual que valida email, negocio y rol. La sesión Google por sí sola no concede una membresía. Usuarios sin negocio siguen el onboarding existente.

## Validación real de esta ejecución

- `npm run typecheck`: PASS.
- `npm test`: 656 PASS, 0 FAIL, 0 SKIP; incluye validación del callback real con IO de Supabase simulado, destinos maliciosos, cancelación, código inválido, invitación y recuperación.
- `npm run lint`: PASS.
- `npm run build`: PASS con Google habilitado y configuración pública de fixture, sin secretos.
- Lectura del login productivo: HTTP 200. No acredita OAuth.
- No ejecutado: OAuth real con Google, cookies productivas tras consentimiento, logout/reingreso, creación de empresa, invitación real o UI mobile. No se modificaron datos ni RLS.

| Estado | Resultado |
| --- | --- |
| IMPLEMENTADO | código de integración listo para revisión; credenciales pendientes |
| PROBADO | checks locales anteriores |
| DESPLEGADO | cambio no publicado a producción |
| VALIDADO EN PRODUCCIÓN | pendiente de Google/Supabase y recorrido E2E |

Próximo paso autorizado: recuperar la consola, obtener la aceptación de la política de Google, crear el cliente, configurar Supabase y la allowlist, habilitar la variable en Vercel, publicar el cambio probado y ejecutar E2E con el usuario autorizado. Sin sugerencias nuevas. Core: no registrado por este chat, work item de este objetivo no identificado de forma única. Este relevo no implica que otro agente haya aceptado la tarea.
