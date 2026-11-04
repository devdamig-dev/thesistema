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
