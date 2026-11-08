# GastroPilot O1 — acta de validación Fudo (sin datos sensibles)

> Plantilla para el primer negocio piloto. **No** es una certificación automática: se completa durante la prueba real con owner/admin autorizado. Nunca pegar API Key, API Secret, Bearer, payloads, identificadores personales o ventas detalladas en GitHub/CI/logs. Guardar evidencia privada y sanitizada en el espacio autorizado.

## Condiciones para iniciar

- [ ] Negocio titular autoriza formalmente el acceso read-only. Cuenta Fudo Plan Pro con API Pública General efectivamente habilitada.
- [ ] Usuario API Fudo de permisos mínimos: alcance de productos, ingredientes, proveedores, pedidos y ventas; ningún permiso de escritura necesario.
- [ ] Owner/admin inicia sesión en GastroPilot en **su propio** `business_id`; credenciales ingresadas sólo por la UI segura `/ajustes/integraciones/fudo`.
- [ ] Identificar dos negocios aislados A y B y usuarios de prueba owner/admin/colaborador. No reutilizar credenciales reales de Fudo fuera del negocio autorizado.
- [ ] Registrar despliegue Vercel READY y SHA productivo, migraciones requeridas aplicadas, y respaldo/plan de reversión. No modificar ventas/stock/caja propios ni escribir a Fudo.

## Acta (completar en soporte privado, nunca con secretos)

| Dato | Valor/evidencia sanitizada |
| --- | --- |
| Fecha y responsable | PENDIENTE |
| Alcance autorizado / sucursal | PENDIENTE |
| Commit y deployment productivos | PENDIENTE |
| Referencia del negocio A/B (alias opaco, sin IDs reales) | PENDIENTE |
| Resultado general | **NO-GO hasta completar todas las verificaciones** |
| Evidencia privada (ubicación y responsable, sin URL pública sensible) | PENDIENTE |

## Prueba end-to-end segura

### 1. Autorización y conexión

- [ ] A/owner conecta por UI: credenciales cifradas server-side, estado verificado, sin secretos en respuesta, DevTools, error ni logs de aplicación.
- [ ] A/admin puede volver a testear; colaborador no puede conectar, rotar ni desconectar (confirmar respuesta API, no sólo botón oculto).
- [ ] Error por credencial inválida, 403/permisos, API no habilitada/404, 429 y caída temporal distinguibles con mensajes sanitizados. No inducir intentos excesivos sobre Fudo.
- [ ] Rotación o desconexión invalida una prueba o sincronización antigua y no preserva checks verdes obsoletos.

### 2. Diagnóstico del proveedor

| Recurso | GET read-only | Conteo de origen en ventana acordada | Registros vistos en ciclo completo | Diferencia explicada |
| --- | --- | --- | --- | --- |
| `products` | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| `ingredients` | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| `providers` | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| `orders` | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |
| `sales` | PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE |

- [ ] Ejecutar `Revisar permisos de importación` y guardar sólo códigos de estado sanitizados. Un 200 de un recurso no acredita los otros cuatro.
- [ ] Para cada recurso accesible comprobar esquema JSON:API real, paginación completa (`links.next`, `page[size]`, páginas), 401/refresh y errores de contrato. No falsear compatibilidad ante cambios legítimos del proveedor; registrar discrepancia y mantener NO-GO.
- [ ] Comparar contra conteos de la misma ventana/filtros y permisos del usuario Fudo. No contar históricos de staging como datos actuales.

### 3. Sync, idempotencia y reconciliación

- [ ] Iniciar ciclo completo read-only para los cinco recursos; estado final `completed`, cinco cursores completos y sin errores sanitizados. Si algún recurso queda parcial/fallido, **no** declarar paridad.
- [ ] Confirmar `business_id + connection_generation + resource_type + external_id` en staging/provenance de forma agregada; nunca publicar payloads o IDs de clientes.
- [ ] Confirmar con el proveedor que los `external_id` de los cinco recursos tienen formato estable: un ID con espacios/tabulaciones periféricos debe generar error controlado sin avanzar cursor (no normalizar ni corregir datos reales en silencio); comparar IDs sólo dentro de evidencia privada, sin exponerlos.
- [ ] Repetir el mismo ciclo: no se duplican registros; las cantidades/importados y resúmenes son consistentes.
- [ ] Documentar registros históricos/no vistos al finalizar un ciclo posterior; distinguir posibles bajas sin borrarlas automáticamente. El error o interrupción no convierte un ciclo parcial en reconciliado.
- [ ] Registrar última sincronización, errores y diferencias sólo con metadatos seguros; contrastar cantidades por recurso con Fudo.

### 4. Multiempresa, roles y no regresión operativa

- [ ] B/owner no puede ver estado, registros, cursores, sync ni credenciales de A, ni mediante parámetros API manipulados.
- [ ] Gate Auth A/B: verificar acceso directo por `businesses.id` con la sesión del otro tenant, además de filtros por `organization_id`. Dos credenciales QA deben resolver a dos identidades Auth distintas; no publicar UUIDs de negocios/usuarios en el artefacto de CI.
- [ ] A/colaborador no puede administrar Fudo; probar 401/403 reales con sesiones independientes A/B, además de tests automáticos RLS.
- [ ] Un retest, rotación, desconexión o sync concurrente de A no cambia el resumen de B; tampoco reaparecen checks de una generación anterior.
- [ ] Constatar que la integración **sólo emitió GET** hacia recursos Fudo (más POST de autenticación), sin POST/PATCH/PUT/DELETE de operaciones Fudo.
- [ ] Confirmar que ventas, pedidos, stock, caja y deudas nativas del cliente no recibieron movimientos creados por el importador.

## Decisión y salida

**GO** únicamente con todos los puntos críticos aprobados, diferencias conciliadas y aceptación explícita del responsable del piloto. De lo contrario: **NO-GO**, registrar incidencia con síntoma, recurso y código sanitizado, guardar evidencia privada y priorizar corrección en O1. No avanzar O2+ ni afirmar reemplazo de Fudo por haber completado una conexión.

**Estados a informar:** IMPLEMENTADO (código mergeado), PROBADO (CI con enlaces y/o acta real), DESPLEGADO (SHA Vercel READY + alias), VALIDADO EN PRODUCCIÓN (acta con cuenta real, sesiones A/B y conciliación, nunca sólo fixtures).

Referencia: [O1 #162](https://github.com/devdamig-dev/thesistema/issues/162), [conciliación #180](https://github.com/devdamig-dev/thesistema/issues/180), `ROADMAP.md`, `QUALITY_GATE.md`.
