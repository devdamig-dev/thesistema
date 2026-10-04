# WhatsApp Agent Core

## Arquitectura

El transporte oficial de Meta normaliza el webhook y entrega el mensaje a un core independiente. El core resuelve el actor por teléfono, negocio receptor, membership, rol, módulos y sucursales; sólo entonces ofrece tools del registro. El modelo nunca recibe acceso a SQL ni un `business_id` elegible.

Flujo: `Meta webhook → resolveActor → toolsForActor → interpret → validate → confirmationGate → execute → audit → Meta Cloud API`.

El endpoint `POST /api/internal/whatsapp-agent` permite probar exactamente el mismo core sin Meta. Requiere `x-agent-secret: $WHATSAPP_AGENT_INTERNAL_SECRET` y un JSON con `sender_phone`, `recipient_phone`, `text` y, opcionalmente, `message_id`.

## Configuración pendiente en Meta

1. Crear o seleccionar una app Business en Meta for Developers y agregar WhatsApp.
2. Configurar Embedded Signup desde **Ajustes → WhatsApp** y completar `META_APP_ID`, `NEXT_PUBLIC_META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` y `META_EMBEDDED_SIGNUP_CONFIG_ID`.
3. Publicar `https://<dominio>/api/webhooks/whatsapp`, usar `META_VERIFY_TOKEN` como verify token y suscribir el campo `messages`.
4. Conceder `whatsapp_business_management` y `whatsapp_business_messaging`; completar Business Verification y App Review para producción.
5. Confirmar que el número queda en `whatsapp_integrations` con estado `connected`. El access token se mantiene server-only.

Sin estos pasos el core sigue siendo comprobable por tests y por el endpoint interno, pero el producto **no muestra ni simula** una conexión con Meta.

## Seguridad y operación

- `provider_message_id` es único y evita ejecutar dos veces un reintento de Meta.
- Las confirmaciones sensibles duran 10 minutos; las aclaraciones, 15 minutos. Se puede responder `No` o `Cancelar` para descartar el pedido.
- Antes de ejecutar una operación sensible, `consumePending` hace un UPDATE condicionado por id, negocio, miembro, `consumed_at IS NULL` y vigencia. Sólo el mensaje que recibe una fila puede ejecutar; dos confirmaciones diferentes no pueden consumir el mismo pedido. Una cancelación compite por esa misma fila y no afirma haber cancelado si la confirmación ya ganó.
- El consumo previo al write garantiza como máximo un intento por confirmación. Si el proceso falla después de consumirla, el pedido debe iniciarse de nuevo; no hay reintento automático de writes sensibles.
- Los argumentos no aceptan `business_id`; el tenant procede exclusivamente del actor resuelto.
- Cada tool valida claves permitidas, tipos, números finitos/positivos, fechas ISO reales, períodos máximos de 366 días y enums antes de guardar contexto o ejecutar. Los argumentos desconocidos se rechazan.
- Un pago de deuda requiere acreedor, monto y medio de pago concretos. La confirmación muestra los tres valores antes de aceptar “Sí”; no se completa silenciosamente con valores por defecto.
- La identidad telefónica falla cerrado si cualquier consulta de integración, negocio, perfil, membership, módulos o sucursales devuelve error. Un teléfono sólo autoriza cuando coincide con exactamente un negocio receptor, un perfil activo y una membership; las coincidencias ambiguas se rechazan.
- Auditoría, mensajes procesados y estado conversacional son tablas server-owned con RLS habilitada y sin grants a `authenticated`/`anon`.
- Los logs sanitizan claves con nombres de token, secreto, password o authorization.

## Alcance conocido

El router incluido es determinístico y cubre las frases MVP. La interfaz `interpret` permite incorporar después un proveedor de modelo con tool calling sin acoplar registry, executor ni transporte. Las compras requieren un proveedor existente y piden medio de pago; los pagos de deuda exigen una coincidencia única del acreedor y confirmación explícita.

## Próximos incrementos

1. Catálogo real de capacidades en Ajustes → IA, derivado del registro y de los módulos/rol activos.
2. Prueba end-to-end con un negocio y número Meta autorizados, incluyendo permisos de rol y sucursal.
