# GastroPilot O1 — QA manual con dos sesiones y RLS real

Este gate **prepara** la comprobación manual de aislamiento del piloto read-only Fudo. El job **autenticado** de `.github/workflows/qa-live-auth.yml` se ejecuta únicamente mediante `workflow_dispatch` sobre `main`; en PR sólo se revisa la sintaxis y se ejecutan **16 escenarios sintéticos**, incluyendo claves públicas `anon` JWT y `sb_publishable_`, sesiones Auth inválidas, acceso cruzado por `organization_id` y `business_id`, descubrimiento anónimo de IDs, errores HTTP y redirecciones. Son pruebas con `fetch` simulado, sin secretos ni acceso a datos reales. Estos tests sólo validan que el gate falla de forma segura; **no equivalen a sesiones A/B productivas**.

## Requisitos

1. Crear **dos usuarios de QA**, no identidades de clientes, con email verificado y password de prueba propio. Deben pertenecer a dos organizaciones distintas sin membresía cruzada y con al menos un negocio por organización; cada identidad QA debe ser **owner/admin** de un negocio propio. Crear/autorizar los datos de QA antes de correr este gate, fuera de la automatización.
2. Guardar en GitHub Actions → Repository secrets: `QA_PUBLIC_KEY` (anon/publishable **del proyecto GastroPilot `thesistema`**, nunca `service_role` o `sb_secret_*`), `QA_USER_A_EMAIL`, `QA_USER_A_PASSWORD`, `QA_USER_B_EMAIL`, `QA_USER_B_PASSWORD`. **Nunca pegarlos en chat, PR o logs.**
3. Desde Actions → **O1 QA Auth real, RLS y acceso Fudo read-only** → Run workflow, elegir la rama `main` una vez integrado el PR. El workflow comprueba `github.ref == refs/heads/main` y hace checkout explícito de `main` antes de acceder a secretos; en otra rama no ejecuta el job autenticado. Rechaza claves privadas (`sb_secret_*` y JWT distinto del rol `anon`) antes de realizar consultas. El endpoint está fijado al proyecto Supabase `tcgcgrftnsuhorssjojk`; no cambiarlo por proyectos de clientes.
4. Guardar el enlace al run, los estados de los jobs y la fecha en el issue O1 #162, sin copiar JWT, emails, respuestas HTTP ni datos de negocios.

## Resultado observable y límites

- Autentica A y B en Supabase Auth y confirma identidades distintas.
- Comprueba que cada usuario ve **sus** organizaciones y negocios de QA, sin ver por RLS los del otro; falla si se comparten organizaciones o no existen registros de prueba.
- Realiza **tres GET por cada negocio visible** a `business_members`: membresía propia (verifica que la consulta pertenezca al negocio y busca rol owner/admin), intento autenticado desde el otro tenant y descubrimiento anónimo del ID de negocio. Exige al menos **una** membresía owner/admin propia por usuario QA en **cualquiera** de sus sucursales; no presupone que la primera tenga ese rol. Un intento autenticado ajeno debe devolver **HTTP 403 o 200 sin filas**; un 401 no acredita RLS. Se revisan *todos* los negocios visibles (máximo 99 por listado), no sólo el primero.
- Realiza **12 GET** a cuatro tablas privadas Fudo (A, B y anónimo × cuatro) y **un GET anónimo por cada ID de organización y negocio** de A/B, todos de sólo lectura. El total de GET anónimos de IDs es variable según la cantidad de organizaciones y sucursales visibles, no cuatro fijos. Cada consulta Fudo con token autenticado A/B debe devolver **HTTP 403**: HTTP 401 indica que la sesión no acredita la prueba. Sólo las consultas privadas anónimas pueden devolver 401/403. Un HTTP 200 con lista vacía en tablas privadas **NO** es suficiente; los cuatro GET anónimos por ID deben devolver 401/403 o HTTP 200 sin filas. Las claves `sb_publishable_` se envían sólo como `apikey`, no como Bearer.
- No devuelve ni imprime la lista de miembros, sus roles, IDs ni otros datos de la respuesta de las consultas: sólo pasa/falla la expectativa. Si un listado contiene 100 filas, el gate falla hasta implementar paginación; jamás declara cobertura incompleta como éxito.
- La consola informa solo PASS/fallo y estado HTTP; no imprime contraseñas, tokens, correos, credenciales Fudo, payloads ni filas privadas.
- La autenticación genera sesiones y auditoría Auth, pero **no altera datos de negocio ni llama a Fudo**. No ejecutar contra cuentas de clientes.

**No acredita** el acceso a la UI de Fudo bajo owner/admin ni el rechazo de acciones server-side para empleados, una conexión API real, la conciliación de cinco recursos, el segundo ciclo idempotente o el smoke en producción autenticado. Completar esos escenarios por separado antes de decidir GO; mantener O1 **NO-GO** hasta contar con pruebas reales autorizadas.

Si faltan secretos, las cuentas no están aisladas o falla RLS, el workflow termina con error y no acredita QA. No declarar los controles probados solo porque exista el script o por el job de sintaxis en CI.

**Estado verificado 10/11/2026:** cobertura de todas las sucursales [PR #322](https://github.com/devdamig-dev/thesistema/pull/322) y detección de owner/admin en cualquier sucursal [PR #323](https://github.com/devdamig-dev/thesistema/pull/323) integrados a `main`. [Quality #42873914219](https://github.com/devdamig-dev/thesistema/actions/runs/42873914219) aprobado sobre `1e006c10`. El job autenticado `two-tenant` **no se ejecutó**; las pruebas sintéticas y el Quality Gate no acreditan aislamiento A/B productivo ni conexión Fudo real. Piloto **NO-GO**.

Referencia: [issue O1 #162](https://github.com/devdamig-dev/thesistema/issues/162) · [PR de preparación anterior #158](https://github.com/devdamig-dev/thesistema/pull/158).
