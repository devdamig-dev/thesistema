# GastroPilot O1 — QA manual con dos sesiones y RLS real

Este gate **prepara** la comprobación manual de aislamiento del piloto read-only Fudo. El workflow `.github/workflows/qa-live-auth.yml` se ejecuta únicamente mediante `workflow_dispatch`. En PR se revisa la sintaxis y se ejecutan **cinco fixtures sintéticas** (1 caso positivo y 4 negativos: HTTP 200 indebido en tabla privada, lectura cruzada A/B, clave de servicio y cuenta QA ausente), sin secretos ni acceso a datos reales. Estos tests sólo validan que el gate falla de forma segura; **no equivalen a sesiones A/B productivas**.

## Requisitos

1. Crear **dos usuarios de QA**, no identidades de clientes, con email verificado y password de prueba propio. Deben pertenecer a dos organizaciones distintas sin membresía cruzada y con al menos un negocio por organización. Crear/autorizar los datos de QA antes de correr este gate, fuera de la automatización.
2. Guardar en GitHub Actions → Repository secrets: `QA_PUBLIC_KEY` (anon/publishable **del proyecto GastroPilot `thesistema`**, nunca `service_role` o `sb_secret_*`), `QA_USER_A_EMAIL`, `QA_USER_A_PASSWORD`, `QA_USER_B_EMAIL`, `QA_USER_B_PASSWORD`. **Nunca pegarlos en chat, PR o logs.**
3. Desde Actions → **O1 QA Auth real, RLS y acceso Fudo read-only** → Run workflow, elegir la rama `main` una vez integrado el PR. El workflow comprueba `github.ref == refs/heads/main` y hace checkout explícito de `main` antes de acceder a secretos; en otra rama no ejecuta el job autenticado. Rechaza claves privadas (`sb_secret_*` y JWT distinto del rol `anon`) antes de realizar consultas. El endpoint está fijado al proyecto Supabase `tcgcgrftnsuhorssjojk`; no cambiarlo por proyectos de clientes.
4. Guardar el enlace al run, los estados de los jobs y la fecha en el issue O1 #162, sin copiar JWT, emails, respuestas HTTP ni datos de negocios.

## Resultado observable y límites

- Autentica A y B en Supabase Auth y confirma identidades distintas.
- Comprueba que cada usuario ve **sus** organizaciones y negocios de QA, sin ver por RLS los del otro; falla si se comparten organizaciones o no existen registros de prueba.
- Realiza 12 GET de sólo lectura en PostgREST (sesiones A, B y anónimo × cuatro tablas privadas Fudo: conexiones, syncs, staging y cursores). Cada consulta **debe** recibir HTTP 401/403; una respuesta HTTP 200 con lista vacía **NO** se acepta como seguridad suficiente.
- La consola informa solo PASS/fallo y estado HTTP; no imprime contraseñas, tokens, correos, credenciales Fudo, payloads ni filas privadas.
- La autenticación genera sesiones y auditoría Auth, pero **no altera datos de negocio ni llama a Fudo**. No ejecutar contra cuentas de clientes.

**No acredita** el acceso a la UI de Fudo bajo owner/admin ni el rechazo de acciones server-side para empleados, una conexión API real, la conciliación de cinco recursos, el segundo ciclo idempotente o el smoke en producción autenticado. Completar esos escenarios por separado antes de decidir GO; mantener O1 **NO-GO** hasta contar con pruebas reales autorizadas.

Si faltan secretos, las cuentas no están aisladas o falla RLS, el workflow termina con error y no acredita QA. No declarar los controles probados solo porque exista el script o por el job de sintaxis en CI.

Referencia: [issue O1 #162](https://github.com/devdamig-dev/thesistema/issues/162) · [PR de preparación anterior #158](https://github.com/devdamig-dev/thesistema/pull/158).
