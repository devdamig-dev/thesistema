---
name: nexodg-integrations
description: Revisar e implementar integraciones reales con Supabase, WhatsApp/Meta, WooCommerce, pagos, CRM y proveedores de IA.
---
# Integraciones y dependencias externas

Usar cuando se conectan APIs, webhooks, credenciales, canales, proveedores de IA, autenticación y sistemas externos.

1. Identificar proveedor, ambiente, alcance, permisos, credenciales disponibles por canales seguros y límites de la API actual.
2. Revisar los contratos del proveedor y la implementación real del proyecto. No asumir que la integración ya funciona por mostrar un estado 'Conectado'.
3. Diseñar autenticación y rotación de secretos, idempotencia, reintentos seguros, validación de webhooks, conciliación, logs sin datos sensibles y recuperación de errores.
4. Usar servidores para las operaciones privilegiadas. Para SaaS multiempresa, relacionar cada token, webhook y registro con tenant autorizado.
5. Probar con credenciales y recursos de test cuando existan; distinguir test/sandbox de producción.
6. Evaluar escenarios de desconexión, expiración de tokens, fallas de permisos, límites, mensajes duplicados y procesos concurrentes.
7. Confirmar evidencia tanto en origen como en destino; si depende de aprobación externa, identificarlo como BLOQUEADO POR PROVEEDOR.

## Casos NexoDG
- WhatsApp/Meta: permisos y estado de revisión, webhooks, número, Embedded Signup cuando corresponda y restricciones de mensajería. No prometer lectura de grupos si la API o permisos no lo admiten.
- Supabase: Auth, RLS, migraciones, policy checks y aislamiento.
- WooCommerce: catálogo, stock, precios por lista, sincronización, conflictos y mapeo de variantes.
- IA: clave/configuración, modelo/proveedor, facturación, observabilidad, límites y respuesta ante errores. No etiquetar como 'IA activa' un mock.
