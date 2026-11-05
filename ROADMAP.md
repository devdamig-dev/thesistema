# GastroPilot — Roadmap operativo hacia plataforma gastronómica todo-en-uno

Estado canónico para agentes: **seguir este archivo en orden y trabajar siempre sobre el primer objetivo no bloqueado**.

## Objetivo final
Convertir GastroPilot en una plataforma SaaS gastronómica integral, IA-first y todo-en-uno capaz de REEMPLAZAR FUDO por completo dentro del alcance definido. Fudo se utiliza únicamente como puente temporal de integración/migración, fuente de datos para pilotos y referencia funcional mientras GastroPilot incorpora capacidades nativas propias.

## Regla de ejecución autónoma
1. Leer `AGENTS.md`, `QUALITY_GATE.md` y la skill pertinente antes de modificar.
2. Elegir el primer objetivo con estado `ACTIVO` o `PENDIENTE` cuyas dependencias estén cumplidas.
3. Definir resultado observable y criterios de aceptación.
4. Implementar en rama/PR; nunca trabajar directamente sobre datos reales de clientes.
5. Ejecutar pruebas pertinentes y registrar evidencia.
6. Actualizar este roadmap y el issue correspondiente.
7. Diferenciar siempre: IMPLEMENTADO / PROBADO / DESPLEGADO / VALIDADO EN PRODUCCIÓN.
8. No avanzar escrituras hacia Fudo hasta completar primero lectura, mapeo, idempotencia, auditoría y aprobación explícita del alcance.

---

## O1 — Integración Fudo para piloto
**Estado: ACTIVO — prioridad máxima**

### Resultado
Un negocio de GastroPilot puede conectar una cuenta Fudo autorizada y consultar datos reales de Fudo en modo lectura, con aislamiento por empresa y sin exponer secretos al navegador.

### Alcance inicial
- Adaptador Fudo server-side.
- Conexión configurable por negocio.
- Validación de credenciales y estado de conexión.
- Sync inicial read-only de catálogo/productos, ingredientes, proveedores, pedidos/ventas y estructuras disponibles.
- Modelo de mapeo Fudo ↔ GastroPilot sin duplicados.
- Registro de sync, errores y última actualización.
- UI de Integraciones > Fudo.
- Desconexión y rotación de credenciales.
- Pruebas de aislamiento multiempresa.

### Criterios de aceptación
- [ ] Ningún secreto Fudo llega al cliente/browser/log.
- [ ] Un owner/admin puede conectar y desconectar; otros roles no.
- [ ] Credenciales de negocio A no pueden usarse desde negocio B.
- [ ] Test de conexión distingue credencial inválida, permiso insuficiente, API no habilitada y error temporal.
- [ ] Sync read-only es repetible sin duplicar entidades.
- [ ] Se registra origen externo y external_id.
- [ ] Se muestra última sincronización y errores sin datos sensibles.
- [ ] Quality Gate del cambio aprobado.
- [ ] Prueba piloto real documentada con una cuenta Fudo autorizada.

### Avance técnico del 03/11/2026
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO:** PR #166 mergeado a main, Quality #112 verde y Vercel Production READY según evidencia del issue #162. UI owner/admin, cifrado por `business_id`, test de lectura, desconexión/rotación, staging privado read-only, cursores, deduplicación, RPCs de exclusión mutua y recuperación de sync abandonada.
- **DB/config:** migración `fudo_pilot_read_only_20261103` y clave maestra server-side aplicadas en el entorno de GastroPilot; las ACL verificadas niegan lectura a `authenticated`.
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO:** PR #167 mergeado a main, Quality #114 verde, Vercel READY. Paginación JSON:API sensible a `links.next`, totales únicos de staging y últimas cinco ejecuciones por conexión para conciliación de piloto.
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR #168 integrado a `main` (commit `0930b952`); Quality #116 completo y Vercel Production `dpl_CycnU6yDfFSyLSR13x3wVqCZZdPR` READY. El owner/admin puede ejecutar un diagnóstico server-side read-only con estado sanitizado para los cinco recursos Fudo; el cliente HTTP no sigue redirects de auth ni de lectura. **Este diagnóstico no equivale a una prueba con credenciales reales ni a una conciliación completa.**
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR #170 mergeado a `main` (SHA `015dc83`); Quality #121 completo y Vercel Production `dpl_GPNN3tXsFu4FJQw5eAuR7g9QhSrQ` READY con alias `gastropilot.nexodg.com`. La conexión inicial y el retest validan la estructura importable JSON:API de `products`: un HTTP 200 incompatible se rechaza, sin guardar nuevas credenciales. Regresiones de falso positivo, respuesta válida y ausencia de persistencia. Sin escritura hacia Fudo. **No equivale a validación con una cuenta real**.
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR #172 integrado a `main` (commit `e6a7fbae`); Quality #126 completo (`success`) y Vercel Production `dpl_4F7PT36ziu4YTDb9Tb31BpenZfZV` en `READY`. La autenticación y reautenticación *single-flight* de los cinco GET read-only evita renovaciones paralelas, y una respuesta HTTP 401 tardía no invalida un token nuevo. Regresiones de cinco 401 paralelos con un solo refresh y recuperación de fallo temporal de autenticación. Sin cambios SQL, sin escrituras hacia Fudo. **No implica validación con credenciales reales del piloto.**
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR #174 mergeado a `main` (SHA `130d1df392cfe01c8e9fbda1fcf30d549baf5ca8`); Quality [#132](https://github.com/devdamig-dev/thesistema/actions/runs/41680542532) completo en `success` y Vercel Production `dpl_AkSSJqEfzGb5PJXDTbZHJ1S39CNb` `READY`. Cinco recursos Fudo se procesan en batches de hasta tres lecturas concurrentes y se espera toda persistencia iniciada antes de cerrar el run; evita secuencias de 75s+ frente al límite serverless de 60s. Sin cambios SQL ni escrituras al proveedor. **No equivale a validación con Fudo real.**
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR [#175](https://github.com/devdamig-dev/thesistema/pull/175) integrado a `main` (SHA `05faea7578666431da985bf9603922bda12306c9`); [Quality #135](https://github.com/devdamig-dev/thesistema/actions/runs/41689642310) `completed/success` y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/H124s1BZZKV6riqbViP8SyydDSMJ) `READY` con alias `gastropilot.nexodg.com`. La UI owner/admin muestra el progreso read-only de cursores para cinco recursos (Sin iniciar / Pendiente: página N / Ciclo leído), filtrando por `business_id` + `connection_generation`; regresión de aislamiento A/B y credenciales rotadas. Sin cambios SQL ni escrituras hacia Fudo. **Un cursor completado no acredita conciliación con el proveedor.**
- **CHEQUEO DE ENTORNO (03/11/2026):** Supabase `thesistema` verificado mediante consulta agregada de sólo lectura: `fudo_connections=0`, `fudo_sync_runs=0`, `fudo_external_records=0`, `fudo_sync_progress=0`. Sin SELECT autenticado de secretos/payloads ni permiso de ejecutar `fudo_begin_sync`. No se inspeccionaron secretos ni contenido comercial.
- **VALIDADO CON FUDO REAL: NO.** Falta cuenta Fudo Plan Pro/API habilitada y prueba con conexión real, permisos por recurso, conteos, paginación, renovación de token y aislamiento A/B con sesiones reales. El staging todavía no alimenta dashboard/IA normalizados; eso corresponde a O2.
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** PR [#177](https://github.com/devdamig-dev/thesistema/pull/177) mergeado a `main` (`cb23b34d175184976334d9a5e53ff64ddec98d16`). [Quality #139](https://github.com/devdamig-dev/thesistema/actions/runs/41708575180) `completed/success` (verify, PostgreSQL17, PostgREST). [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/HtBGHmJvvfnvEzzfDQcizZA8uNkD) `READY` para ese SHA y alias `gastropilot.nexodg.com`. El retest está limitado a `business_id + connection_generation` y rechaza resultados de una generación rotada (regresión 200/403); retest y sync ya no transportan ciphertext en filtros de URL PostgREST. No cambia SQL ni escribe en Fudo. **VALIDADO CON CUENTA REAL: NO** (0 conexiones/sync/registros de staging en SQL agregada de solo lectura).
- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (03/11/2026):** preflight multisesión PR [#179](https://github.com/devdamig-dev/thesistema/pull/179), SHA `44d74c84f324e61510c0157d6e81ea6500005f0b`; [Quality #142](https://github.com/devdamig-dev/thesistema/actions/runs/41719004477) completo y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/CNMY8CLqAnaiaVgfjkJsafjY1VHW) READY. Descarta checks leídos con credenciales rotadas/desconectadas; sin prueba con cuenta Fudo real.

- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (04/11/2026):** PR [#181](https://github.com/devdamig-dev/thesistema/pull/181) fusionado a main (`79977f9aec752a6bcf4858768e990be142030c52`); [Quality](https://github.com/devdamig-dev/thesistema/actions/runs/41758111534) completo/success (verify, PostgreSQL17 y PostgREST), [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/DgsjpVyP9amJ2FZtiZa4XRuJa7BA) READY con alias `gastropilot.nexodg.com`. Migración aditiva de ciclos aplicada previamente en Supabase `thesistema` y columnas/ACL verificadas por SQL de sólo lectura; 0 conexiones, 0 sync, 0 registros y 0 cursores. El panel diferencia guardados históricos, vistos en ciclo UUID y posibles ausencias sólo con cursor completo y última ejecución cerrada; sin borrar staging. **VALIDADO CON FUDO REAL: NO**; mantener O1 activo y issue [#180](https://github.com/devdamig-dev/thesistema/issues/180) abierto para conciliación real.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO (04/11/2026):** PR [#184](https://github.com/devdamig-dev/thesistema/pull/184) integrado a `main` (SHA `04d212edaeb6118d511870248e01d90b65d1265a`); [Quality](https://github.com/devdamig-dev/thesistema/actions/runs/41771404982) `completed/success` (verify, PostgreSQL 17 y PostgREST) para el HEAD del PR y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/6uzLDUNh4vgwf3Hsh47hCQCpLTGc) `READY` con alias `gastropilot.nexodg.com`. El resumen Fudo revalida `business_id + connection_generation` tras leer conteos y cursores; descarta lecturas obsoletas por rotación/desconexión concurrente (regresiones sintéticas), sin leer ciphertext en la revalidación. Sin migración SQL ni escrituras a Fudo. **VALIDADO CON FUDO REAL: NO**; falta conexión autorizada y conciliación E2E.

- **IMPLEMENTADO / PROBADO (CI) / DESPLEGADO (04/11/2026):** [PR #186](https://github.com/devdamig-dev/thesistema/pull/186) integrado a `main` (squash `e771a511e0477224758b420ef2afdb0fad82e666`); [Quality #41790250586](https://github.com/devdamig-dev/thesistema/actions/runs/41790250586) `completed/success` (verify, PostgreSQL 17 y PostgREST, incluyendo Playwright), [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/39SXzTaWUh3wWm31yYHkoJ3kqDYu) `READY` con alias `gastropilot.nexodg.com`. El importador rechaza `external_id` JSON numéricos inseguros/fraccionarios antes de upsert y cursor, preserva IDs grandes cuando son strings; regresión read-only comprueba histórico intacto y cursor no avanzado ante página inválida. Sin migraciones SQL ni escrituras hacia Fudo. SQL agregada sólo lectura (04/11): 0 conexiones, 0 sync, 0 registros importados y 0 cursores. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; faltan credenciales autorizadas Plan Pro/API, sync real, conciliación y aislamiento E2E.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO (04/11/2026):** PR [#188](https://github.com/devdamig-dev/thesistema/pull/188) integrado a `main` mediante squash `d015dbf5b40329501d0f46b007296be860bc3d71`; [Quality #41804811773](https://github.com/devdamig-dev/thesistema/actions/runs/41804811773) `completed/success` para HEAD `2a1210f6` con `verify` (tests, TypeScript, lint, build, Playwright), `postgres17` y `postgrest` aprobados. [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/GXuPoa3vdhQs3dRsWzKWjrCUo68m) `READY` para SHA `d015dbf5`, alias `gastropilot.nexodg.com` confirmado por Vercel. Test de conexión, diagnóstico y sync validan `links.next` antes de informar `available` o persistir snapshots, preservando staging y cursor ante paginación inválida. Regresión sintética GET-only con error sanitizado. Sin SQL ni escrituras a Fudo. **Smoke autenticado en producción y cuenta Fudo real NO validados**: la cuota Vercel bloqueó sólo el check preview del HEAD pero el build productivo del squash final sí llegó a `READY`. O1 sigue ACTIVO y O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO (04/11/2026):** [PR #190](https://github.com/devdamig-dev/thesistema/pull/190) fusionado a `main` (squash `4b884b9c185bf0f906d32dffa53b164b66c07c87`); [Quality #41813487701](https://github.com/devdamig-dev/thesistema/actions/runs/41813487701) completo/`success` (`verify` con tests, TS, lint, build, Playwright; `postgres17` y `postgrest`), y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/AHy6kAftudmg9S2Wm833xxSovxDH) `READY` para ese SHA. El adaptador no asume que cualquier `links.next` es una página válida: rechaza dominios externos, enlaces no HTTPS, cursores no soportados y páginas saltadas/repetidas; evita continuar una importación incongruente sin escribir en Fudo ni staging de esa página. El primer CI detectó un fixture obsoleto que aceptaba un link externo; el test se corrigió para requerir rechazo y el gate se volvió a ejecutar completamente. Sin migraciones SQL, escrituras Fudo ni cambios de ventas, pedidos o stock nativos. SQL agregada de sólo lectura (04/11): 0 conexiones Fudo, 0 runs, 0 staging y 0 cursores; RLS activa, sin SELECT directo a roles `anon`/`authenticated`. **VALIDADO CON FUDO REAL: NO**; pendiente cuenta autorizada Plan Pro/API, importación paginada, conciliación y QA E2E tenant A/B. O1 sigue ACTIVO y O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #192](https://github.com/devdamig-dev/thesistema/pull/192) fusionado a `main` (`93bb5269`) rechaza continuaciones `links.next` hacia otro recurso Fudo antes de persistir staging/cursor en conexión, diagnóstico y sync read-only. [Quality #41816442684](https://github.com/devdamig-dev/thesistema/actions/runs/41816442684) completo/success con `verify` (Playwright), `postgres17` y `postgrest`. El despliegue inicial de #192 se demoró por cuota Vercel HTTP 402, **bloqueo resuelto mediante el siguiente deploy exitoso**: [PR #193](https://github.com/devdamig-dev/thesistema/pull/193) integrado a main (`29f6ddedec3c2e1b9de19860abae55d7f7118bef`), [Quality #41825488817](https://github.com/devdamig-dev/thesistema/actions/runs/41825488817) completo/success en los tres jobs y [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/D7L1RqtXkEBPX8FfoR92ENm47FQ8) `READY`, con alias `gastropilot.nexodg.com` confirmado. #193 también corrige una regresión **de test** AES-GCM no determinista (mutación textual de base64url sustituida por alteración real del tag cifrado), sin cambiar runtime ni esquema SQL. SQL agregada read-only del 04/11: 0 conexiones, 0 sync, 0 registros importados, 0 cursores; RLS activa en cuatro tablas Fudo y sin SELECT directo a `anon`/`authenticated`. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**: aún falta smoke autenticado con sesión del piloto, cuenta Plan Pro/API autorizada, cinco recursos, conciliación y aislamiento A/B. O1 sigue ACTIVO, O2+ pendiente; no hubo escrituras hacia Fudo ni movimientos operativos.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #195](https://github.com/devdamig-dev/thesistema/pull/195) integrado a main (`86d02e10`) endurece `links.next` frente a filtros, cursores, fragmentos y parámetros ignorados; valida sintácticamente `page[size]`, sin duplicados. [Quality #41835366420](https://github.com/devdamig-dev/thesistema/actions/runs/41835366420) completo/success (verify con Playwright, PostgreSQL17, PostgREST); [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/2WT9buSBnxLRFVMKvh4auiis9VJe) `READY`, commit `86d02e10` y alias `gastropilot.nexodg.com` confirmados. SQL agregada read-only 04/11: 0 conexiones, 0 sync, 0 registros, 0 cursores; cuatro tablas con RLS y sin SELECT a anon/authenticated. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO.**
- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #196](https://github.com/devdamig-dev/thesistema/pull/196) integrado a main (squash `f1d66ba11b8d9d4f2adf46aa16122d4180f9220d`). Corrige discrepancias de `page[size]` en `links.next`: importación solicita 100 y preflight/test solicitan 1; ante tamaño distinto rechaza la página antes del staging/cursor con error sanitizado. [Quality #41844046177](https://github.com/devdamig-dev/thesistema/actions/runs/41844046177) completo/success con `verify` (npm test, TS, lint, build, Playwright), `postgres17` y `postgrest`. [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/BAMjbbg9xnm494XNTEZQkkDCXXqR) `READY`, commit confirmado y alias `gastropilot.nexodg.com` apuntando al deploy. SQL agregada read-only del 04/11: 0 conexiones Fudo, 0 sync runs, 0 registros importados y 0 cursores. Sin migraciones SQL, sin escrituras hacia Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; falta sesión autenticada, API autorizada, conciliación de cinco recursos y aislamiento A/B real. Si el proveedor reduce `page[size]` de manera legítima, habrá que diseñar tamaño efectivo durable por recurso/ciclo antes de habilitar la conciliación; no saltear registros. O1 ACTIVO, O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #198](https://github.com/devdamig-dev/thesistema/pull/198) integrado a `main` (squash `3f8716ac0e07876415cc47e16a48ad12c4460c34`). Rechaza páginas con más registros que `page[size]` solicitado (1 en conexión/diagnóstico; 100 en sync), incluso HTTP 200 y `links.next: null`, evitando falsos positivos antes de staging/cursor. [Quality #41864719700](https://github.com/devdamig-dev/thesistema/actions/runs/41864719700) `completed/success` (verify con npm test, TS, lint, build, Playwright; postgres17 y postgrest). [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/9W92bJ7L9AT248nTzx135nvU6d3T) `READY` para el SHA integrado, con alias `gastropilot.nexodg.com` comprobado. SQL SELECT agregada 04/11: 0 conexiones, 0 sync, 0 staging, 0 cursores. Sin SQL de escritura, ni secretos en logs, ni llamadas mutantes a Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; faltan sesión autenticada, cuenta autorizada Plan Pro/API, conciliación de cinco recursos y aislamiento A/B E2E. O1 ACTIVO; O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #200](https://github.com/devdamig-dev/thesistema/pull/200) integrado a `main` (squash `d6781a2b6984303fab961449b86857f2d5325cd9`). Añade panel consultivo **NO-GO** en Ajustes > Fudo: conexión de productos, diagnóstico GET de cinco recursos en sesión, cinco cursores y último run `completed` y conciliación/QA A/B **siempre pendiente hasta prueba real**; nunca acredita piloto automáticamente ni expone credenciales. [Quality #41883782458](https://github.com/devdamig-dev/thesistema/actions/runs/41883782458) `completed/success` (verify con `npm test`, TS, lint, build, Playwright, `postgres17`, `postgrest`). [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/DgXEtWqQazaSEYnao7fbjm131fo3) `READY` con commit `d6781a2b` y alias `gastropilot.nexodg.com` confirmado. Regresiones sintéticas para permisos parciales, errores e incompletitud. Sin SQL, nuevas llamadas al proveedor ni escrituras Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; O1 ACTIVO/NO-GO, falta cuenta autorizada, conciliación E2E y aislamiento multiempresa.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #202](https://github.com/devdamig-dev/thesistema/pull/202) integrado a main (squash `a8fc929b96717a94b8e99c585f4a583497cd8b0f`). El checklist informativo invalida un diagnóstico anterior cuando la conexión queda desconectada/en error o su revisión (`status` + `lastTestedAt`) cambia tras rotación/retest y refresco: no debe mostrar permisos antiguos en verde. [Quality #41894424912](https://github.com/devdamig-dev/thesistema/actions/runs/41894424912) `completed/success` (verify con unitarias, TypeScript, lint, build y Playwright; PostgreSQL 17 y PostgREST). [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/21pmySPk7P4UTFb78g3Qsz22hRDt) `READY` para el SHA integrado, alias `gastropilot.nexodg.com` confirmado. SQL agregada read-only: 0 conexiones, sync, registros y cursores; RLS habilitada en cuatro tablas. Sin migración SQL ni escrituras hacia Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; faltan cuenta autorizada, cinco recursos, conciliación real y aislamiento autenticado A/B. O1 ACTIVO/NO-GO, O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #204](https://github.com/devdamig-dev/thesistema/pull/204) integrado a main (squash `e894351c4c82048a883169423270001321012134`) y [Quality #41912542772](https://github.com/devdamig-dev/thesistema/actions/runs/41912542772) completo/success en verify (incluyendo Playwright), PostgreSQL 17 y PostgREST. El resumen revalida metadatos de la conexión al terminar los agregados para descartar retests y cambios de sync sin rotar generación. [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/E9ndVFZKeAaS7NYAxV7t9j7qPazR) para ese SHA, alias `gastropilot.nexodg.com` confirmado por Vercel. Smoke público HTTP 200 (sin sesión); **sin smoke autenticado ni cuenta Fudo real**. Sin SQL mutante, secretos ni escrituras Fudo.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #205](https://github.com/devdamig-dev/thesistema/pull/205) integrado a `main` (squash `081fd543808d3358b2d145b0e96f038ee5111f72`). El resumen invalida conteos y cursores si cambia el ID, estado o marcas temporales del último `fudo_sync_runs` mientras se leen agregados para el mismo `business_id + connection_generation` (incluye run nuevo o cierre concurrente). [Quality #41922660599](https://github.com/devdamig-dev/thesistema/actions/runs/41922660599) `completed/success`: `verify` (pruebas, TypeScript, lint, build y Playwright), PostgreSQL17 y PostgREST. [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/HBcZAEm6WE7CV8XqS1y1UEKfuaeG) confirmado para el SHA del merge, alias `gastropilot.nexodg.com` verificado. No hay migración SQL, secretos nuevos ni escrituras a Fudo. SQL agregada read-only 04/11: `0` conexiones, syncs, staging y cursores. **VALIDADO CON FUDO REAL: NO**; falta cuenta autorizada, conciliación de 5 recursos y aislamiento E2E autenticado. O1 sigue ACTIVO / piloto NO-GO, O2+ pendiente.

- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (04/11/2026):** [PR #207](https://github.com/devdamig-dev/thesistema/pull/207) integrado a `main` (squash `7aa850363ce1b8f4c66d33ffe6cbd53137ad3d58`). El diagnóstico read-only de cinco recursos revalida `business_id`, `connection_generation`, `status` y `last_tested_at` tras los GET para invalidar comprobaciones anteriores a un retest concurrente sin rotación de credenciales. [Quality #41938669365](https://github.com/devdamig-dev/thesistema/actions/runs/41938669365) `completed/success`: `verify` (npm test, UI fixtures, typecheck, lint, build y Playwright), `postgres17` y `postgrest`. [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/Bm7FSuEtutaJPWkwRgczfUWJYoga) `READY` para SHA `7aa85036` con alias `gastropilot.nexodg.com`. Regresiones sintéticas cubren retest exitoso/fallido y conexión estable. SQL agregada de sólo lectura en Supabase `thesistema` (05/11 UTC): 0 conexiones, 0 syncs, 0 staging, 0 cursores y 4 tablas Fudo con RLS activa. No hubo cambios SQL, secretos en navegador ni escrituras hacia Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO**; falta API autorizada, conciliación de cinco recursos y aislamiento A/B con sesiones reales. **O1 ACTIVO / NO-GO; O2+ PENDIENTE**.
- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (05/11/2026 UTC):** [PR #209](https://github.com/devdamig-dev/thesistema/pull/209) integrado a `main` mediante squash `3b52f40fa55a011eebd8cc3db985677741607595`. El retest read-only de Fudo usa compare-and-set por `business_id + connection_generation + last_tested_at` para que un resultado antiguo (p. ej., 403 tardío) no sobreescriba un test más reciente; la revisión avanza monótonamente incluso cuando dos tests terminan en el mismo milisegundo o hay desfase de reloj. Regresiones sintéticas de concurrencia y reloj atrasado. [Quality #41958500094](https://github.com/devdamig-dev/thesistema/actions/runs/41958500094) `completed/success` (verify con npm test, typecheck, lint, build y Playwright; postgres17 y postgrest). [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/Erpyrz3vK1q4AD5sjoLifg14JWmH) `READY` para ese SHA con alias `gastropilot.nexodg.com`. SQL agregada exclusivamente de lectura: 0 conexiones, 0 corridas, 0 staging y 0 cursores Fudo; RLS activa en las cuatro tablas y sin SELECT `anon`/`authenticated`. Sin migraciones ni escrituras a Fudo o movimientos nativos. **VALIDADO CON FUDO REAL: NO; piloto O1 NO-GO.** Pendiente API autorizada Plan Pro, conciliación real de cinco recursos y QA autenticado A/B; smoke HTTP externo no comprobable desde este entorno. O2+ pendiente.
- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (05/11/2026 UTC):** [PR #211](https://github.com/devdamig-dev/thesistema/pull/211) integrado a `main` mediante squash `8cbd0134a7ea2a098c29cd4ca9b1ca7f902454ec`. El adaptador clasifica respuestas HTTP 200 de autenticación Fudo con JSON `null`, array o primitivo (o token no utilizable) como `invalid_response` sanitizado, en lugar de excepción genérica; sin iniciar lectura de recursos ni filtrar secretos. [Quality #41965474069](https://github.com/devdamig-dev/thesistema/actions/runs/41965474069) `completed/success`: `verify` (npm test, fixtures, TypeScript, lint, build y Playwright), `postgres17` y `postgrest`, con regresión sintética para seis respuestas de auth incompatibles. [Vercel Production](https://vercel.com/damians-projects-a45d01bf/thesistema/8x653vnpuFcsyWmp97E7w68UgsVF) `READY` para el SHA del merge con alias `gastropilot.nexodg.com` confirmado. Sin cambios SQL, credenciales persistidas ni escrituras hacia Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO** (sin cuenta autorizada, sync/conciliación de cinco recursos o QA autenticado multiempresa A/B). O1 ACTIVO / NO-GO; O2+ PENDIENTE.
- **IMPLEMENTADO / PROBADO EN CI / NO DESPLEGADO EN PRODUCCIÓN (05/11/2026 UTC):** [PR #213](https://github.com/devdamig-dev/thesistema/pull/213) integrado a `main` mediante squash `e81ed7155a5b915c4452eeb18a793b04d48fa836`. El diagnóstico read-only Fudo vincula su revisión opaca SHA-256 server-side a `business_id`, `connection_generation`, `status` y `last_tested_at`, evitando que la UI reutilice checks verdes de cinco recursos tras cambiar de negocio con el mismo estado y fecha. Regresiones sintéticas A/B (incluida generación/fecha idénticas) y descarte fail-closed de revisiones ausentes. [Quality #41978029221](https://github.com/devdamig-dev/thesistema/actions/runs/41978029221) `completed/success`: `verify` (tests, UI fixtures, TypeScript, lint, build y Playwright), `postgres17`, `postgrest`. **DESPLIEGUE BLOQUEADO:** GitHub reportó Vercel `failure` para el SHA productivo (límite de cantidad de despliegues, sin activación de facturación); no afirmar release disponible hasta verificar READY del SHA final. Sin migraciones SQL, exposición de IDs crudos/secretos, escrituras Fudo ni mutaciones comerciales reales. SQL agregada de solo lectura en `thesistema`: 0 conexiones, 0 runs, 0 staging, 0 cursores y cuatro tablas con RLS activa, sin SELECT `anon`/`authenticated`. **VALIDADO CON FUDO REAL: NO; O1 ACTIVO / NO-GO, O2+ PENDIENTE.**
- **PUBLICACIÓN DE #213 CONFIRMADA (05/11/2026):** [PR #214](https://github.com/devdamig-dev/thesistema/pull/214) integrado a main (squash `86f13799107ca5cc5cd413d922fbcff647150a0b`); [Quality #41979332182](https://github.com/devdamig-dev/thesistema/actions/runs/41979332182) con `verify`, `postgres17` y `postgrest` en success. [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/9cT9vAv3ZQsrPXC7UDshZULq8Waq) confirma el SHA y alias `gastropilot.nexodg.com`, por lo que el ajuste de aislamiento de #213 está incluido en la versión publicada. El intento anterior había fallado por cuota. **No equivale a smoke autenticado ni validación real con Fudo**. No se hicieron escrituras en Fudo.
- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (05/11/2026 UTC):** [PR #215](https://github.com/devdamig-dev/thesistema/pull/215) integrado a `main` mediante squash `51db6bc421073941f90aff49f10de92880b24304`. El adaptador de autenticación Fudo rechaza tokens Bearer vacíos, con espacios o caracteres de control y longitudes superiores a 8192 antes de enviar Authorization o hacer GET. Cinco casos de regresión sintética verifican `invalid_response`, cero lecturas de recursos y errores sin secretos. [Quality #41985287396](https://github.com/devdamig-dev/thesistema/actions/runs/41985287396) `completed/success` para `verify` (tests, TS, lint, build, Playwright), `postgres17` y `postgrest`. [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/7BtnGndru3KZMp5q5LmBenkes7xe) confirmado para ese SHA, y alias `gastropilot.nexodg.com` apunta a ese deployment. El status Vercel del HEAD del PR marcó fallo por cuota de builds preview; **no bloqueó la publicación productiva del squash**. Sin migraciones SQL, secretos nuevos ni escrituras a Fudo. **VALIDADO EN PRODUCCIÓN CON FUDO REAL: NO; O1 ACTIVO / PILOTO NO-GO, O2+ PENDIENTE**. Faltan cuenta Fudo autorizada/API habilitada, sync y conciliación real de cinco recursos, y QA autenticado A/B.
- **IMPLEMENTADO / PROBADO EN CI / DESPLEGADO EN PRODUCCIÓN (05/11/2026 UTC):** [PR #217](https://github.com/devdamig-dev/thesistema/pull/217) fusionado a `main` (squash `00ce1a7692135876deb51c21d9642c47db246e45`). Si Fudo devuelve un Bearer válido **sin** `exp`, el cliente reutiliza ese token con lease conservador de 10 minutos, margen de refresh de 5 minutos y renovación ante 401, evitando nuevos POST por cada GET. Una expiración explícita inválida/vencida produce `invalid_response` sin GET. [Quality #42006901803](https://github.com/devdamig-dev/thesistema/actions/runs/42006901803) `completed/success` (`verify`, `postgres17`, `postgrest`) con regresiones sintéticas de cinco recursos, reutilización, renovación y rechazo fail-closed. [Vercel Production READY](https://vercel.com/damians-projects-a45d01bf/thesistema/G9NutgK3giqEmCJVqNYQRYN9Qcv1) para **ese mismo SHA** y alias `gastropilot.nexodg.com` confirmados en Vercel. Sin SQL, exposición de credenciales ni escrituras hacia Fudo o datos operativos nativos. **VALIDADO EN PRODUCCIÓN CON CUENTA FUDO REAL: NO** (la respuesta `exp` ausente sólo fue simulada). O1 continúa ACTIVO / PILOTO NO-GO; O2+ pendiente. Procedimiento de evidencia sin secretos: `docs/integrations/fudo-pilot-evidence-template.md`.
- **No marcar O1 completo** hasta evidencia E2E real de una cuenta autorizada y dashboard/IA de piloto verificados.

### Dependencia externa
La API Pública General de Fudo requiere Plan Pro y credenciales/API habilitadas por el negocio.

---

## O2 — Capa de datos operativos unificada
**Estado: PENDIENTE**

### Resultado
Dashboard, IA y reportes consumen un modelo normalizado independiente del proveedor (Fudo o nativo).

- [ ] Entidades canónicas de producto, ingrediente, proveedor, pedido, venta, mesa y usuario.
- [ ] Provenance/source por registro.
- [ ] Estrategia de conflictos y reconciliación.
- [ ] Métricas de ventas/costos operando sobre datos normalizados.
- [ ] IA puede consultar esos datos respetando tenant/rol.

Dependencia: O1.

---

## O3 — Gestión propia: stock, recetas, costos, compras y proveedores
**Estado: PENDIENTE**

### Resultado
GastroPilot cubre la gestión administrativa central sin depender de Fudo.

- [ ] Recetas y escandallos.
- [ ] Stock e inventario valorizado.
- [ ] Compras/proveedores.
- [ ] Costos y margen por producto.
- [ ] Mermas y alertas.
- [ ] Conciliación con datos importados desde Fudo durante convivencia.

Dependencia: O2.

---

## O4 — Operación: pedidos, mesas, comandas y KDS
**Estado: PENDIENTE**

### Resultado
El restaurante puede operar salón/cocina desde GastroPilot.

- [ ] Pedidos y estados.
- [ ] Mesas/salones.
- [ ] Comandas.
- [ ] KDS cocina con tiempos y alertas.
- [ ] Roles camarero/cocina/caja.
- [ ] Tiempo real y recuperación ante desconexión.
- [ ] Idempotencia/concurrencia.

Dependencia: O3.

---

## O5 — Caja, pagos, reservas, delivery y canales
**Estado: PENDIENTE**

### Resultado
GastroPilot puede ser el sistema principal de operación de un negocio gastronómico.

- [ ] Caja y cierres.
- [ ] Pagos/conciliación.
- [ ] Reservas.
- [ ] Delivery/canales externos.
- [ ] Facturación según alcance regulatorio definido.
- [ ] CRM e historial del cliente.
- [ ] WhatsApp como canal de reservas/consultas/aprobaciones.

Dependencia: O4.

---

## O6 — IA operativa y automatización
**Estado: PENDIENTE EN PARALELO, sólo sobre capacidades reales**

### Resultado
La IA de GastroPilot entiende el estado del negocio y propone/ejecuta acciones permitidas con aprobación cuando corresponda.

- [ ] Consultas de ventas, costos, stock, pedidos y rendimiento.
- [ ] Alertas de demoras, faltantes, margen y mermas.
- [ ] Proyección de compras/demanda.
- [ ] Borradores de pedidos a proveedores.
- [ ] Acciones con approvals y auditoría.
- [ ] Motor/proveedor/plan visibles al cliente.
- [ ] Fallback honesto cuando IA o integración no estén disponibles.

Dependencias: se habilita incrementalmente con O1–O5.

---

## Métricas de salida del objetivo final
GastroPilot sólo se considera objetivo cumplido cuando un negocio piloto puede operar una jornada completa, desde apertura hasta cierre, SIN FUDO para las funciones incluidas en el alcance: operación, mesas, pedidos, comandas/KDS, stock, recetas, compras, proveedores, caja, pagos, reservas, CRM, reportes e IA operativa, con QA E2E, roles, aislamiento multiempresa, móvil, recuperación de errores y evidencia de producción. La integración con Fudo debe quedar como herramienta opcional de migración/importación, no como dependencia operativa.
