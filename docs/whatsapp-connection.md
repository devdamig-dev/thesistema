# Conexión de WhatsApp para clientes de Thesistema

## Alcance y estados

El cliente entra con una persona owner/admin de Thesistema y autoriza su cuenta mediante Meta. No crea una app de desarrollador por cada negocio, no pega access tokens y no tiene que dar de baja su WhatsApp. La elegibilidad final del número y los activos que Meta permite compartir no dependen exclusivamente de nuestro código.

Se distinguen dos recorridos: WhatsApp Business app en el celular, que debe conservar la aplicación mediante el recorrido oficial de Coexistence; y una cuenta ya habilitada en Cloud API. No se migra un proveedor ni se registra/desregistra un número automáticamente. WhatsApp personal no es WhatsApp Business app. Esta versión no realiza altas nuevas de números que todavía requieran registro en Cloud API.

`idle → authorizing → preparing → choosing → connecting → linked`. La autorización sola nunca es éxito. La UI exige elegir y confirmar el número real. `linked` significa autorización y suscripción comprobadas más integración persistida, no certifica recepción/respuesta E2E. Una configuración incompleta de nuestra app se informa como problema de plataforma, no como requisito que deba resolver cada cliente.

## Configuración de plataforma (una vez, no por cliente)

- App de Meta Business habilitada para WhatsApp y Facebook Login for Business. Tener la app publicada no demuestra que todos sus permisos cuenten con el nivel de acceso necesario para clientes externos.
- Configuración Embedded Signup vigente: revisar la versión y los productos/recorridos seleccionados en la configuración guardada, incluyendo WhatsApp Business app/Coexistence y el acceso a cuentas API existentes según el producto. La integración usa `config_id`, `response_type: code`, `override_default_response_type: true`, `extras: {}`. No aplica flags de versión heredada a una configuración v4.
- `NEXT_PUBLIC_META_APP_ID` y `META_APP_ID`: la misma aplicación. `META_APP_SECRET`: sólo servidor.
- `NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID`: configuración guardada general/API. Opcional `NEXT_PUBLIC_META_WHATSAPP_BUSINESS_APP_CONFIG_ID`: configuración específica para Business app; si falta, se usa la general y debe ofrecer ese producto en Meta. No se inventa otro Configuration ID ni se considera habilitada Coexistence por tener esta variable.
- `META_GRAPH_VERSION` / `NEXT_PUBLIC_META_GRAPH_VERSION`: versión Graph soportada. No confundir versión Graph con versión de Embedded Signup.
- Dominios JSSDK: autorizar los orígenes HTTPS estables realmente usados. No usar un comodín sobre todos los previews.
- `META_WEBHOOK_CALLBACK_URL`: URL HTTPS canónica del receptor. Para este proyecto: `https://gastropilot.nexodg.com/api/webhooks/whatsapp`. No depende del dominio de preview desde el que se pruebe el consentimiento.
- Registrar esa callback en Meta, con el valor de `META_VERIFY_TOKEN` ya protegido en el entorno, y el campo `messages`. El GET debe superar la verificación. El servidor valida HMAC `x-hub-signature-256` antes de interpretar cualquier evento.
- Permisos `whatsapp_business_management` y `whatsapp_business_messaging`: habilitar y aprobar el acceso requerido para cuentas de clientes externos en Meta, incluyendo la revisión/verificación que corresponda al producto. El backend comprueba que el token de cada autorización los contiene y pertenece a nuestra app.
- La habilitación específica de Tech Provider/Coexistence y la elegibilidad del número deben comprobarse en Meta con la configuración real. No se da por concedida por el conector de soporte de ChatGPT.

**Estado observado el 2026-10-07 durante el desarrollo:** negocio propietario verificado y app Gastro Pilot publicada; la lectura de Meta todavía mostraba callback ausente y cero campos suscritos. Los permisos avanzados y productos de la configuración no se certificaron. Esta observación debe volver a consultarse: no es un diagnóstico permanente. Las credenciales protegidas existen en Vercel; no se califican como ausentes por no poder leerlas. Falta completar una autorización real de cliente y mensajes de ida/vuelta para certificar Meta E2E.

## Servidor y datos

- `/api/integrations/whatsapp/complete` acepta acciones tipadas `prepare`, `connect` y `cancel`; rechaza claves extra y `business_id` del cliente. Exige mismo origen, sesión activa owner/admin y perfil activo.
- `prepare` intercambia el código una sola vez en servidor, verifica token/app/permisos/vigencia, resuelve cuentas desde las concesiones reales si el evento no contiene un número y enumera los números con paginación. No elige el primero silenciosamente. Los links `paging.next` no se ejecutan: sólo se reutiliza un cursor en el origen Graph fijo.
- El navegador recibe únicamente datos de selección y un identificador opaco. Los tokens permanecen en `whatsapp_signup_sessions`, tabla server-owned con RLS y sin grants a anon/authenticated. La sesión está vinculada a usuario/negocio, dura diez minutos y se consume atómicamente. Las sesiones expiradas se eliminan al preparar una nueva; un mantenimiento periódico independiente puede reducir su retención física, pero la caducidad ya impide utilizarlas.
- `connect` vuelve a comprobar autorización y estado actual del número, verifica la callback y suscribe la app de forma aditiva. No borra suscripciones de otro proveedor. El número debe estar habilitado en Cloud API; en el recorrido Business app Meta debe confirmar también `is_on_biz_app`.
- `complete_whatsapp_signup` persiste integración, flags del negocio, auditoría y consumo de sesión en una transacción. Revalida actor/rol activo y tenant; no sustituye un número diferente de ese negocio ni asigna un número ya usado por otro tenant. El secreto temporal se borra al finalizar o fallar tras el claim.
- Meta y Postgres no comparten transacción: una suscripción aditiva puede haberse realizado si la persistencia posterior falla. En ese caso no se devuelve éxito ni se reejecuta una migración; se informa que hay que comprobar/reautorizar la vinculación. No se elimina la suscripción de otros sistemas.

Aplicar, antes de usar la nueva UI en producción:
1. `20261007201500_whatsapp_signup_sessions.sql`.
2. `20261007201600_whatsapp_member_conversation.sql`.

## Conversaciones y permisos

Ajustes → WhatsApp permite seleccionar una persona activa del negocio, confirmar su teléfono internacional, acotar una sucursal y autorizar/pausar el chat directo. La confirmación de pertenencia del teléfono es explícita por el administrador; no se presenta como una verificación OTP. Sólo permite establecer un teléfono vacío; cambiar un teléfono ya registrado requiere revisión separada de identidad. Rechaza identidades telefónicas ambiguas, miembros de otro tenant y sucursales no permitidas al miembro. No modifica roles ni habilita módulos adicionales.

El RPC `set_whatsapp_member_conversation` es server-only y audita el permiso en la misma transacción. La pertenencia del remitente y su alcance se vuelven a resolver en Agent Core en cada mensaje. Los chats no autorizados no entran en una ruta alternativa de extracción en Inbox.

## Transporte seguro y límites explícitos

El receptor resuelve el negocio por **cuenta + phone_number_id** de Meta, no por coincidencias de teléfono visible. Itera todos los mensajes de todos los cambios del webhook. Sólo los eventos nuevos de texto entrante en chats directos pueden llegar al agente. Estados de entrega, historial, `smb_app_state_sync`, `smb_message_echoes`, ecos salientes, grupos y medios no implementados reciben acuse sin convertirse en operaciones. Se descartan mensajes anteriores a la vinculación y timestamps futuros inválidos.

La deduplicación durable de Agent Core precede las operaciones y las copias de Inbox: reintentos no crean una segunda operación. Esto garantiza a lo sumo un intento de las acciones protegidas, no entrega exactamente-una-vez de las respuestas. Si Meta rechaza una respuesta se audita; no se reejecuta una acción sensible para reconstruirla. Una outbox durable de respuestas queda como incremento separado si las pruebas de transporte lo requieren.

Esta conexión **no importa ni lee grupos del WhatsApp móvil**, no ejecuta mensajes históricos y no hace OCR/transcripción de medios. No se muestra soporte de esas capacidades como si ya existiera.

## QA de aceptación

Ejecutar `npm test`, `npm run typecheck`, `npm run lint` y `npm run build`. Probar con fixtures controlados las sesiones y RPC (éxito, replay, expiración, actor ajeno, rol revocado, conflicto de teléfono, auditoría, rollback). Probar UI con SDK y respuestas controladas cubre la composición y orden de callbacks; no equivale a una prueba real de Meta.

Cierre externo: un owner/admin de un cliente real completa Business app conservando su app, elige un número autorizado y finaliza la vinculación; otro caso de cuenta Cloud API existente; mensajes de ida/vuelta desde una conversación autorizada, denegación de actor/tenant ajenos, deduplicación y confirmación sensible. No llamar terminado ese QA sin las credenciales/permisos y consentimiento reales.

Referencias oficiales consultadas: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4 ; https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users ; https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes . Algunas aperturas completas devolvieron 429; no sustituyen la prueba real de la configuración Meta.
