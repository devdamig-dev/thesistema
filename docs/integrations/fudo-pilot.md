# Integración Fudo — piloto GastroPilot

## Decisión
Fudo será inicialmente un **proveedor externo de datos/operación**. GastroPilot debe tratarlo como adaptador intercambiable, no como dependencia estructural.

## Fuente oficial verificada (2026-11-02)
Fudo publica una API Pública General autogestionada para Plan Pro. La documentación de soporte indica acceso a clientes, descuentos, gastos, ingredientes, ítems, cocinas, pagos, métodos de pago, pedidos, categorías/modificadores/productos, proveedores, roles, salones, ventas, subítems, mesas y usuarios. La API usa OpenAPI 3 y las credenciales pertenecen a un usuario de Fudo con permisos específicos.

Documentación técnica indicada por Fudo: https://dev.fu.do/api
Centro de ayuda: https://soporte.fu.do/es/articles/11939789-api-publica-de-proposito-general

## Fase 1 — discovery y contrato
- Confirmar auth exacta contra documentación OpenAPI.
- Confirmar endpoints, paginación, filtros de fecha, rate limits y renovación de token.
- Definir conjunto mínimo para piloto: products, ingredients, suppliers, orders/sales.
- Clasificar endpoints read-only vs mutaciones.
- No implementar escrituras en esta fase.

## Fase 2 — conexión
Ruta propuesta: `/ajustes/integraciones/fudo`.

La configuración debe:
- requerir owner/admin;
- ser server-side;
- asociar credenciales a `business_id`;
- permitir rotación/revocación;
- nunca devolver secret completo;
- registrar estado: disconnected / validating / connected / error / expired.

## Fase 3 — sincronización read-only
Crear mapeos externos con:
- provider = fudo
- resource_type
- external_id
- business_id
- local_id nullable
- last_seen_at
- source_updated_at nullable
- sync_hash/version

La primera importación no debe escribir movimientos financieros ni de stock propios. Debe poder repetirse sin duplicar.

## Fase 4 — piloto
1. El cliente habilita API Pública General en Fudo (Plan Pro).
2. Crea usuario API de permisos mínimos.
3. Las credenciales se cargan por canal seguro, nunca por chat/issue.
4. Test de conexión.
5. Sync read-only.
6. Comparar conteos/totales de una ventana acordada.
7. Habilitar dashboard/IA sobre datos importados.
8. Documentar discrepancias y go/no-go.

## Riesgos
- Token por defecto con vencimiento de 24h: confirmar renovación oficial antes de automatizar.
- Permisos del usuario Fudo determinan visibilidad.
- Cambios de schema/API requieren adapter versionado.
- No asumir que un 200 significa datos completos; reconciliar conteos y rangos.
- No mezclar IDs Fudo con IDs internos.


## O1 — Diagnóstico de permisos previo al piloto (03/11/2026)
- Acción **Revisar permisos de importación**: sólo owner/admin con membresía activa puede ejecutarla; las credenciales se recuperan cifradas del servidor, ligadas al `business_id`.
- Ejecuta GET de muestra (página 1, tamaño 1) en productos, ingredientes, proveedores, pedidos y ventas, sin persistir datos de proveedor, registrar resultados crudos ni crear movimientos nativos.
- Para cada recurso indica solamente `available`, `forbidden`, `invalid_credentials`, `api_unavailable`, `rate_limited`, `provider_unavailable` o `invalid_response`. Un HTTP 200 con esquema incompatible no acredita acceso utilizable.
- La autenticación se inicia una vez por diagnóstico; la consulta de cinco recursos es paralela para respetar límites de duración del servidor.
- El cliente Fudo usa `redirect: "error"` tanto en el POST de autenticación como en GETs de lectura, para no redirigir secretos/tokens a otro destino.
- Ningún resultado del diagnóstico equivale a conciliación completa, permisos de otras operaciones o validación con datos reales. La aplicación no realiza ninguna escritura en la API Fudo.
- QA requerida: owner/admin, denegación por rol y membresía, A/B con distintas claves, caso 403/404/error temporal, redirecciones y esquema inválido. Validar en la cuenta piloto real una vez que se conecte.
