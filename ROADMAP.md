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
- **IMPLEMENTADO EN RAMA / PR #172 EN REVISIÓN (QA PENDIENTE):** reautenticación *single-flight* para sondas simultáneas y GETs read-only; una respuesta HTTP 401 tardía no invalida el token actualizado por otra lectura. Regresiones propuestas: cinco GET 401 simultáneos causan un solo refresh y fallos temporales de auth no bloquean un nuevo intento. No modifica SQL ni hace escrituras a Fudo. **No probado por CI ni desplegado hasta completar gates**.
- **VALIDADO CON FUDO REAL: NO.** Falta cuenta Fudo Plan Pro/API habilitada y prueba con conexión real, permisos por recurso, conteos, paginación, renovación de token y aislamiento A/B con sesiones reales. El staging todavía no alimenta dashboard/IA normalizados; eso corresponde a O2.
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
