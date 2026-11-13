# IA comercial — checkout, pagos y créditos

Mandato del propietario del 10/11/2026. Tracking: issue #164. Esta entrega es independiente del piloto Fudo y NO lo declara habilitado.

## Resultado observable de la primera entrega
Un owner/admin activo de un negocio QA autorizado puede abrir `/ajustes/ia/pagos`, elegir un producto del catálogo persistido, crear una orden idempotente y abrir Mercado Pago sandbox. Un webhook con firma válida obliga a consultar el pago canónico y comprobar ID, referencia, comercio receptor, moneda, importe y modo. El historial sólo se actualiza después de esa verificación. El regreso del checkout no activa nada.

**No es todavía facturación comercial ni suscripción recurrente.** Los pagos de prueba jamás modifican `ai_business_plans` ni generan `ai_business_credit_grants`. Los precios ARS de sandbox se configuran explícitamente; NO son la conversión ni el reemplazo de los precios USD del catálogo. Vercel Production bloquea el checkout.

## Brecha corregida: packs que no se podían consumir
El catálogo y `ai_business_available_credits` contemplaban extras, pero `reserve_ai_usage` sólo admitía cuota mensual. La nueva migración agrega atribución mensual y reservas por grant: toma primero cuota mensual y luego packs no vencidos en orden de expiración. Las reservas y finalizaciones comparten el lock del negocio. Un fallo/cancelación libera el saldo; una finalización repetida no vuelve a descontar. Un grant que vence durante una inferencia puede liquidar la reserva previa, pero no admite una nueva.

`get_my_ai_credit_balance()` expone únicamente saldo del negocio propio a un perfil activo. Los costos internos y tablas privadas de pagos/asignaciones no se exponen a usuarios autenticados o anónimos. La pantalla existente de IA consulta ese saldo en lugar de restar todo el uso a la cuota mensual.

## Configuración exclusivamente server-side para QA aislado
Aplicar las migraciones primero en un proyecto/branch de base de datos de prueba, nunca sobre clientes como parte de esta entrega.

- `AI_BILLING_MODE=sandbox`
- `AI_BILLING_APP_ORIGIN`: origen HTTPS exacto del entorno QA, sin path, query o credenciales.
- `AI_BILLING_SANDBOX_BUSINESS_ID`: UUID del negocio sintético habilitado.
- `AI_BILLING_SANDBOX_PRICES_ARS_JSON`: mapa de SKU a centavos ARS de prueba; mínimo 100, máximo 100000000. Ejemplo **sintético, no tarifa comercial**: `{"starter":10000,"pack_5k":10000}`.
- `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` (32+ caracteres) y `MERCADOPAGO_COLLECTOR_ID`: configurar por canales seguros, nunca en commits, logs ni chat.
- Configurar notificaciones de pagos a `/api/ai-billing/mercadopago`. El route handler verifica `x-signature` y `x-request-id`; no depende de una sesión de navegador. El proxy existente excluye `api/`.

Usar las cuentas de prueba oficiales, nunca tarjetas ni pagadores reales. Sólo se acepta `sandbox_init_point` en `sandbox.mercadopago.com.ar`; los pagos con `live_mode=true` son rechazados. No se habilita live con una variable de entorno.

## QA requerido

### Automatizado
- `tests/ai-billing-core.test.ts`: firma, replay, identificadores ambiguos, importes exactos, identidad del receptor, modo sandbox, allowlist de redirecciones, HTTP con origen fijo, error sanitizado y límite de respuesta.
- `tests/ai-billing-sql.test.ts`: ejecuta migraciones reales en PGlite con datos sintéticos; saldo mensual+packs, holds, devolución, idempotencia, expiración, negocio A/B, órdenes inmutables, pago repetido, reversos, doble aprobación y privilegios.
- Quality Gate del repositorio: TypeScript, lint, build, tests y suites existentes.
- La prueba PGlite no acredita concurrencia PostgreSQL multi-sesión ni integración real con Mercado Pago. Ejecutar también esas pruebas antes de producción.

### Con proveedor sandbox real (pendiente hasta configuración segura)
1. Owner/admin A compra producto con cuenta de prueba; verificar orden y preference persistidos.
2. Aprobar pago de prueba; webhook y GET canónico actualizan historial. Saldo IA real permanece igual.
3. Reenviar notificación; no duplicar orden, pago ni saldo. Modificar importe/moneda/referencia/receptor y comprobar rechazo.
4. Probar pendiente, rechazo, devolución parcial/total, contracargo, evento antiguo y dos pagos aprobados para una orden (requiere revisión manual).
5. Viewer, usuario desactivado y negocio B no pueden crear checkout de A ni leer sus registros.
6. Revisar desktop/móvil, sesión expirada, provider timeout y navegación de regreso. Nunca acreditar por query string.

## Operación y recuperación
Una orden queda `creating` si hay timeout o no se pudo persistir la respuesta de la preferencia: el mismo request NO vuelve a enviarse al proveedor. Reconciliar esa operación con la referencia antes de una nueva prueba. Se limita la creación a diez órdenes por negocio/hora. No hay retry automático de una mutación incierta.

Los webhooks transitorios responden 503 para permitir reintento. Una firma inválida o un pago incompatible responden 400. Firmas antiguas (más de diez minutos) requieren un reintento firmado reciente o conciliación autorizada; no se debilita la firma para recuperar un evento. Estados de revisión son persistentes; no se resuelven automáticamente con un evento posterior. No se almacenan cuerpos del proveedor, datos del pagador, tokens ni firmas.

## Próximos hitos del issue #164
1. **Gate sandbox:** configurar cuenta receptora QA y credenciales seguras, aplicar migraciones sólo en QA y completar el recorrido real y A/B.
2. **Contratación comercial:** definir moneda/tarifas de cobro, impuestos/condiciones, cuenta receptora y política de prorrateo. No inventar tipo de cambio.
3. **Suscripciones:** implementar renovaciones con el contrato específico del proveedor, período vigente y vencimiento; no convertir un pago único en cuota mensual perpetua. Pago pendiente no habilita plan.
4. **Activación de packs live:** grant único por pago aprobado, reversos de saldo no consumido, manejo de saldo ya consumido y contracargos con reglas explícitas; hard cap y conciliación.
5. **Cobro real:** autorización de lanzamiento, migración revisada, PostgreSQL concurrente, QA A/B, prueba controlada y registro de evidencia. OpenAI real y pricing/routing del proveedor se validan por separado.

## Publicación y rollback
Dos migraciones aditivas: `20261111001000_ai_credit_reservations.sql` y `20261111002000_ai_billing_sandbox.sql`. La primera reemplaza reserve/finalize conservando sus firmas y agrega atribución mensual; la segunda contiene sólo órdenes/verificación sandbox.

No aplicar en producción antes del Quality Gate y revisión. Hacer respaldo y revisar grants/reservas activas. El cambio de saldo requiere desplegar UI y migración coordinados; sin RPC la UI informa indisponibilidad, no inventa saldo. Para deshabilitar checkout: retirar `AI_BILLING_MODE` y conservar ledger. No hacer down migration ni borrar asignaciones con reservas activas; reconciliar antes de revertir el algoritmo de consumo. El SQL viejo no conoce packs y no debe restaurarse sobre usos nuevos sin plan explícito.

## Estado de esta entrega
IMPLEMENTADO en rama; pruebas unitarias locales de pagos: 9/9 aprobadas con transporte simulado. SQL/Quality Gate del PR se registran en el issue con SHA exacto. NO DESPLEGADO y NO VALIDADO con proveedor real. No se han realizado cobros, inferencias ni cambios a datos productivos.

Fuentes oficiales consultadas para el contrato:
- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/notifications
- https://www.mercadopago.com.ar/developers/es/reference/preferences/_checkout_preferences/post
- https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_id/get
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
