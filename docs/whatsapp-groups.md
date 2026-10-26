# Grupos oficiales de trabajo

## Acuerdo de producto

Un administrador crea o elige un grupo de WhatsApp dedicado al negocio, selecciona su sucursal y autoriza integrantes del equipo. El agente registra únicamente mensajes de texto nuevos de ese grupo y mantiene las confirmaciones separadas por persona. La pertenencia al grupo no otorga permisos nuevos sobre el negocio.

## Requisitos externos

La API oficial de grupos requiere un número en Cloud API, sin coexistencia con WhatsApp Business app, y una cuenta oficial de WhatsApp (OBA) aprobada. Los grupos de la app del celular no se importan. Meta documenta un máximo de ocho participantes y acceso por invitación.

El panel comprueba el número (`is_on_biz_app`, `platform_type`, `status`), la aprobación OBA y los campos de webhooks antes de habilitar acciones. Una respuesta incompleta o un error de Meta se informa como comprobación fallida. No se interpreta como aprobación.

La app debe suscribir `messages`, `group_lifecycle_update`, `group_participants_update`, `group_settings_update` y `group_status_update` con su callback canónica. La cuenta de mensajería del número debe seguir suscrita a GastroPilot. No se cambia el número, el token, la cuenta ni las suscripciones automáticamente desde esta pantalla.

## Recorrido implementado

1. **Comprobar acceso a grupos:** valida requisitos reales y enumera exclusivamente los grupos asociados al número conectado.
2. **Crear grupo:** registra un intento durable, solicita la creación con `approval_required` y espera confirmación en la lista de Meta. Una respuesta perdida no se reintenta automáticamente ni genera un ID ficticio. Una referencia o un nombre con creación pendiente no puede crear otro grupo inadvertidamente.
3. **Elegir grupo:** comprueba de nuevo su pertenencia al número. El administrador elige sucursal y entre una y ocho personas activas. Puede completar teléfonos vacíos mediante confirmación explícita; no puede sustituir una identidad existente ni habilitar un chat directo como efecto secundario.
4. **Invitar:** el administrador copia el enlace oficial y lo comparte. GastroPilot no envía invitaciones automáticamente.
5. **Aprobar ingreso:** sólo acepta solicitudes cuyo teléfono corresponde a un integrante autorizado y con acceso vigente a la sucursal.
6. **Operar o pausar:** cada mensaje valida actor, grupo, número, activación, integrantes presentes, sucursal y permisos actuales. Pausar retira las confirmaciones pendientes; reautorizar inicia una nueva ventana de procesamiento.

## Acceso y respuestas compartidas

- La conversación queda vinculada a negocio + número + grupo; no se selecciona por nombre ni por teléfono visible.
- Un integrante desconocido, inactivo, ambiguo o sin acceso a la sucursal impide procesar el grupo.
- Como todos los presentes ven las respuestas, las tools disponibles son la intersección de sus permisos. El rol del remitente conserva sus restricciones. Los chats individuales mantienen su comportamiento anterior.
- Se revalidan integrantes y permisos antes de publicar la respuesta, porque pueden cambiar mientras se procesa una operación.
- Las confirmaciones se vinculan a negocio, miembro y conversación: un “Sí” de otra persona no confirma una operación ajena.
- Los mensajes recibidos antes de autorizar el grupo, historiales, ecos, estados y medios no implementados no ejecutan operaciones.
- Las credenciales permanecen en servidor. Las escrituras son server-only; las tablas nuevas tienen RLS y las lecturas administrativas se limitan al negocio correspondiente.

## Estado externo observado el 26 de octubre de 2026

El negocio piloto tiene un único número vinculado mediante WhatsApp Business app. Esa modalidad impide habilitar grupos oficiales. Este desarrollo no migra ni desconecta ese número. Todavía debe elegirse un número apto y obtenerse la aprobación OBA para ejecutar una prueba real de grupo. Un build y los tests con fixtures no certifican ese recorrido externo.

La conexión del proyecto admite una integración principal por negocio. Incorporar un número adicional simultáneo o sustituir la integración actual requiere una etapa específica de onboarding; no se simula como una renovación de permisos.

## Validación y continuidad

Ejecutar `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` y `node scripts/run-catalog-sql.mjs whatsapp-groups`. Las pruebas SQL usan las migraciones reales en una base aislada y deshacen los fixtures.

Antes de habilitarlo con personas reales: completar requisitos de Meta, crear un grupo, autorizar al menos dos integrantes, confirmar una operación por su autor, rechazar la confirmación de otro integrante, verificar pausa, revocación y un reintento del webhook. No enviar mensajes ni invitaciones de prueba a terceros sin una instrucción concreta.

Referencias oficiales consultadas:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts/

Próximos pasos autorizados: terminar la validación técnica y publicar esta evolución con sus requisitos visibles; continuar el alta cuando se identifique el número destinado a grupos. Sugerencias nuevas: ninguna. La elección/migración del número y la solicitud OBA no se han ejecutado ni se dan por aprobadas por Meta. Core: work item no identificado de forma única; no registrado por este chat. Disponible para continuidad desde este documento y la rama `codex/whatsapp-official-groups`.
