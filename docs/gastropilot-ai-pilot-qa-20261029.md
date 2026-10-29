# QA del piloto de IA y fuentes de lectura — 2026-10-29

## Diagnóstico

- El motor administrado realiza inferencia (ledger real y credencial configurada), pero el chat interno sólo usaba intent matching. Las preguntas generales terminaban en `intent_not_recognized`.
- Las conversaciones operativas de WhatsApp requieren miembros del equipo para preservar permisos; no deben reutilizarse para una fuente pasiva.
- El estado `connected` de Meta no certifica entrega de un mensaje o respuesta de la IA.

## Implementación

1. Chat interno: las intenciones registrables conservan tool registry, pending ID, permisos y confirmación. Cuando no hay operación ni pending, usa ayuda conversacional **sólo lectura**. FAQs frecuentes tienen respuesta directa; otros casos recurren al gateway medido por negocio. La indisponibilidad y el límite se explican sin simular éxito.
2. Ajustes IA: reportan el último modelo con ejecución completada desde el ledger real del negocio y el plan actualmente asignado. No se inventan capacidades disponibles.
3. WhatsApp fuentes: nuevo circuito **separado** de personas del equipo, con teléfono E.164, sucursal, autorización administrativa y consentimiento expreso. Meta no entrega listado de chats personales ni historial; los nuevos mensajes directos de una fuente activa se clasifican heurísticamente y quedan **pendientes de revisión en Inbox**. El circuito nunca llama Agent Core ni responde por WhatsApp.
4. La captura se realiza en una RPC transaccional y deduplicada por mensaje de Meta. Se impide capturar históricos anteriores al alta. Todas las tablas nuevas están protegidas sin permisos para clientes de la Data API.

## Control de publicación

- Ejecutar `npm run typecheck`, `npm run lint`, `npm test`.
- Migración `20261029020000_whatsapp_read_sources.sql` **antes** de publicar código. SQL validado con `BEGIN; ... SELECT to_regclass(...); ROLLBACK;` en la base del piloto, sin impacto persistente.
- Desplegar Vercel y comprobar con cuenta administradora que /ajustes/whatsapp muestre Fuentes de solo lectura.
- Probar: (a) «¿Cómo cargo las ventas?» y «¿Ya estás conectada?» en /chat; (b) registrar fuente de lectura sin crear Team member; (c) enviar texto entrante desde el número autorizado después de habilitar la fuente; (d) verificar una sola fila pendiente en Inbox, sin operación ni respuesta automática; (e) replay del mismo id Meta no duplica; (f) pausar fuente impide nuevas capturas; (g) teléfono desconocido ignorado; (h) operación sensible conserva confirmación.
- En la pantalla Ajustes IA, comprobar el modelo y evento completado y diferenciar esa verificación de Meta connected.

## Limitaciones deliberadas

La extracción en Inbox usa heurísticas actualmente, no una inferencia de modelo para cada mensaje. Los adjuntos de WhatsApp y la lectura de grupos preexistentes no están soportados por esta ruta; sólo mensajes de texto entrantes directos, sin escritura automática. El plan piloto administrado no representa un precio comercial final.
