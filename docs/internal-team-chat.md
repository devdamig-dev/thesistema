# Chat interno del equipo

GastroPilot incorpora `/chat` para conversaciones por sucursal con integrantes del negocio. WhatsApp conserva su conexión y sus chats individuales autorizados. El transporte interno usa las cuentas de GastroPilot, sin requerir teléfono ni cambios en Meta.

## Comportamiento

- Owner/admin crea y configura grupos de hasta 50 integrantes de la sucursal. Las personas se incorporan desde Equipo y roles; no se envían invitaciones automáticamente.
- Mensajes normales, fotos JPG/PNG/WebP, PDF y audios de hasta 20 MB. Grabación de hasta 120 segundos con reproducción antes de enviar.
- «Pedir ayuda a la IA» es explícito. Los adjuntos se transcriben/interpretan sin ejecutar operaciones. El usuario revisa el texto y solicita la carga; los cambios requieren confirmación.
- Reutiliza el Agent Core existente: ventas, compras resumidas, deudas, stock, productos y consultas de facturas, según módulos y permisos. No incorpora nuevas escrituras automáticas para gastos, cierres o adelantos.
- PWA instalable, notificaciones web opcionales y actualización del chat cada cuatro segundos mientras está visible. Las páginas, mensajes y adjuntos privados no se almacenan en el service worker. Sin conexión se suspende el envío.

## Acceso y consistencia

Las seis tablas nuevas tienen RLS y carecen de grants para `anon`/`authenticated`. Las rutas autenticadas resuelven el negocio desde la sesión y verifican la membresía activa, la sucursal y el grupo. `service_role` queda exclusivamente en servidor. Los archivos usan un bucket privado, subida firmada sin sobrescritura y lectura autenticada con streaming y soporte de rangos.

La audiencia de cada respuesta de IA limita las herramientas a los permisos comunes. Los cambios de rol exigen reautorizar integrantes. Una persona nueva ve el historial desde su ingreso; cambiar su rol renueva ese límite. La configuración del grupo queda bloqueada mientras una solicitud mantiene su lease.

Cada mensaje tiene un UUID estable para reintentos. Una solicitud de IA se reclama una sola vez. La confirmación está asociada al usuario, negocio, grupo y operación pendiente exacta. Un resultado interrumpido se muestra como incierto y no vuelve a ejecutar una escritura automáticamente. Los mecanismos de recuperación durables de ventas, compras y deudas siguen siendo los del núcleo existente.

Las notificaciones contienen texto genérico, sin datos del negocio. El servidor solo acepta endpoints HTTPS de los proveedores de push conocidos. Las claves VAPID se generan y persisten en una tabla exclusivamente de servidor.

## Validación y publicación

- `npm test`: 603 pruebas al 26/10/2026; incluye transporte interno, autorización, adjuntos, confirmaciones y paginación del historial.
- `node scripts/run-catalog-sql.mjs internal-chat`: pasó sobre 78 migraciones reales en PostgreSQL aislado; fixtures revertidos.
- `npm run typecheck`, `npm run lint`, `npm run build`: verificación local.
- `tests/internal-chat-ui.browser.mjs`: prueba del componente real en escritorio y 390 px con backend controlado, envío/reintento, confirmación, PDF y micrófono simulado; incluida en Quality.
- Antes de producción: aplicar `20261026210624_internal_team_chat.sql`, comprobar tablas, grants y bucket; después publicar el commit aprobado por CI y verificar el chat en el negocio piloto.

## Continuidad

Implementación autorizada: completar validación, migración y publicación; conservar WhatsApp directo. No se autorizó migrar el número ni enviar invitaciones o mensajes a otras personas.

Bloqueo externo observado: `apply_migration` devolvió `Invalid or expired requestState` dos veces, sin crear las tablas; Browser agotó el tiempo de conexión. Aún no se confirmó la migración ni la publicación de esta evolución. Código subido en https://github.com/devdamig-dev/thesistema/pull/152, rama `codex/internal-team-chat`, hacia `main`.

Próximos pasos autorizados: aplicar y verificar la migración en `tcgcgrftnsuhorssjojk`, esperar Quality, publicar en el proyecto Vercel `thesistema` y comprobar el negocio piloto. Sugerencias nuevas: ninguna. Disponible para otro ejecutor si el acceso sigue bloqueado; punto de entrada: la migración y esta PR. Core: no registrado por este chat, porque no se identificó un work item inequívoco.
