# Diagnóstico de elegibilidad de WhatsApp (2026-10-08)

## Hallazgos verificados

El video aportado muestra el selector servido por Meta con varios números de distintos portfolios deshabilitados y el aviso «Este número no se puede compartir con esta aplicación». Este punto es anterior al evento FINISH, al intercambio de código y a `WhatsAppGraph.phones`. Cambiar `selectable` en nuestro backend no modifica ese selector ni concede permisos en Meta.

Main de partida: `46de8cc2c03d09318f2bccfe3e1aa300e5fb47aa`. #134 ya envía `featureType: whatsapp_business_app_onboarding` para Business App. No se revierte esa corrección; la configuración de productos/permisos guardada en Meta sigue siendo independiente del flag.

Lectura actual de la app Gastro Pilot: publicada, callback configurado y 10 campos suscritos, incluidos `messages` y `account_update`. No corresponde seguir describiendo el callback como ausente. Los campos `history`, `smb_app_state_sync` y `smb_message_echoes` no aparecen en esa lectura. Se deben revisar para el recorrido Coexistence, conservando las suscripciones existentes; esta revisión NO demuestra que su ausencia sea la causa del selector bloqueado.

## Qué comprobar en la app proveedora, no en cada cliente

En Gastro Pilot, revisar la configuración Facebook Login for Business `1091635356942042`: variación Embedded Signup, producto Cloud API y permisos realmente seleccionados. No añadir productos de anuncios, conversiones u otros activos que el MVP no utiliza. Verificar la sección Tech Provider onboarding y el acceso avanzado aprobado a `whatsapp_business_management` y `whatsapp_business_messaging`. Publicar una app y verificar su negocio propietario no prueba que esa app esté autorizada a administrar las cuentas de terceros.

La herramienta disponible comprueba publicación/callback, pero no devuelve el contenido de esa configuración ni el resultado de App Review. Sus estados no se marcan como aprobados ni como ausentes sin la evidencia del panel. La ausencia de cuentas productivas en el portfolio propietario de la app tampoco prueba que un cliente deba mover su número a ese portfolio o crear su propia app.

Whaticket ofrece tanto Cloud API como Coexistencia oficial. Su guía de Coexistencia pide elegir ese modo y el recorrido de conexión mediante la app/QR oficial de Meta. El éxito allí no certifica permisos de Gastro Pilot, pero sí impide atribuir automáticamente el problema a un número incompatible o asumir que Whaticket sólo usa WhatsApp Web.

## Corrección incluida

Meta documenta que un error reportado por el usuario puede llegar como `CANCEL` con `error_code`, `session_id` y `timestamp`. Antes se interpretaba como cancelación voluntaria y se perdían esas referencias; `ERROR` también perdía el detalle. Ahora ambos se distinguen de una cancelación real.

Se conservan exclusivamente código numérico, referencia de sesión con formato acotado y timestamp válido. Se descartan mensajes libres, teléfonos, códigos OAuth, tokens, cuerpos completos y campos desconocidos. El API rechaza inyección de tenant, revalida miembro activo/rol, exige sesión y mismo origen y aplica rate limit. El registro usa `activity_logs` con actor/negocio resueltos en servidor y `source=browser_report_unverified`: nunca sirve para autorizar una cuenta, modificar su elegibilidad, suscribirla o ejecutar tools.

La interfaz sólo dice diagnóstico guardado tras persistencia confirmada. Un fallo conserva la referencia visible sin simular éxito. Espera brevemente el evento de error cuando el callback de login sin código llega primero. La instrumentación depende de que Meta emita el evento: no inventa códigos a partir de un tooltip ni garantiza capturarlos de una ventana anterior.

## Próxima comprobación exacta

1. Revisar capturas del panel de la configuración y los permisos avanzados (sin secretos), más el estado Tech Provider.
2. Desde la versión nueva, iniciar Business App, usar «Informar del error a Gastro Pilot» dentro del popup si el selector sigue bloqueado, y comprobar código/referencia en la pantalla y en la auditoría privada del negocio.
3. Con esa evidencia decidir si corregir la configuración proveedora, solicitar/revisar App Review o analizar una restricción concreta de cuenta/proveedor previo. Nunca desregistrar, migrar ni borrar un número para forzar el proceso.
4. Sólo después de autorización y selección real, comprobar cuenta → mensaje entrante → acción permitida persistida → respuesta. No contabilizar esta revisión como Meta E2E exitoso.

## Fuentes primarias consultadas

- Meta, implementación y formato de eventos reportados: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- Meta, Embedded Signup v4 y productos/permisos: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4
- Meta, alta Tech Provider y acceso avanzado: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Meta, Business App onboarding y webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta, errores de Embedded Signup: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors
- Whaticket, guía de Coexistencia oficial: https://help.whaticket.com/es/articles/20787-como-activar-la-coexistencia-de-whatsapp-en

Las páginas de Meta se leyeron mediante sus variantes públicas `.md` desde el runner, dado que la herramienta de navegación respondió 429. No se accedió al panel privado ni se usaron secretos para leer documentación pública.
