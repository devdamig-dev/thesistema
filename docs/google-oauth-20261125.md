# Google OAuth — 25 de noviembre de 2026

GastroPilot utiliza su proyecto Supabase `tcgcgrftnsuhorssjojk`, separado de Core.
El cliente web pertenece al proyecto Google `nexodg-gastropilot-auth` y retorna a
`https://tcgcgrftnsuhorssjojk.supabase.co/auth/v1/callback`.
Los secretos permanecen exclusivamente en Supabase. El proveedor Google está
habilitado sin omitir nonce ni aceptar cuentas sin email.

El dominio principal es `https://gastropilot.nexodg.com`. El inicio usa PKCE de
Supabase SSR y vuelve a `/api/auth/callback` en el mismo origen; después del
intercambio de código se conserva únicamente un destino interno validado.
Los errores, cancelaciones y códigos vencidos conservan el destino seguro y
la invitación. Aceptarla sigue requiriendo la validación existente de sesión,
email y negocio; el callback no crea empresas ni membresías.

Vercel: `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` únicamente en producción.
Los retornos permitidos incluyen el callback con query, login con query y
recuperación de contraseña del dominio principal; se mantienen los alias
existentes de thesistema.vercel.app. Site URL apunta al dominio principal.

La compilación detectó los avisos de Next.js 16.4.3. Se aplicó el parche oficial
16.4.5 y la misma versión de eslint-config-next, conservando React 19.3.0 y
el contrato Supabase SSR. Referencia:
https://nextjs.org/blog/november-2026-security-release

Validación local tras el parche: 823 pruebas PASS, typecheck PASS, lint PASS y
build de producción PASS. La ejecución CI, deployment y smoke real se registran
en el PR de esta entrega; estos resultados locales no acreditan por sí solos
el acceso de producción.

Rollback: restaurar el deployment previo y desactivar la variable pública en
el siguiente build si se detecta un defecto. No se modifican tablas ni datos
de negocio. La política existente permanece en `/privacidad`.
