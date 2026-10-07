# Contrato de persistencia de conexión (2026-10-07)

Complementa `whatsapp-connection.md`: la tabla efectiva de las sesiones nuevas es **`whatsapp_connection_sessions`**, no `whatsapp_signup_sessions`.

Durante la validación se detectó una tabla `whatsapp_signup_sessions` ya creada por migraciones externas recientes, con contrato de una cuenta (`actor_id`, `waba_id`, `used_at`). La migración inicial de esta rama fue rechazada transaccionalmente porque esperaba `user_id`: no se alteraron datos ni se borró/reinterpretó el contrato preexistente. La nueva implementación usa un nombre distinto y conserva la tabla anterior intacta. No debe desplegarse en paralelo otro handler del mismo endpoint con un contrato diferente; cualquier propuesta paralela debe reconciliarse con esta rama.

Orden de migraciones versionadas del incremento:
1. `20261007201500_whatsapp_signup_sessions.sql`: crea `whatsapp_connection_sessions` y RPC de consumo/persistencia/auditoría.
2. `20261007201600_whatsapp_member_conversation.sql`: RPC de autorización explícita del chat del equipo.
3. `20261007201700_whatsapp_public_status.sql`: lectura de columnas no secretas bajo RLS owner/admin. No concede SELECT de `access_token` ni SELECT de toda la tabla.

Ajustes lee el estado con el cliente autenticado y sus políticas RLS. Ninguna renderización de Ajustes usa service-role. La API de conexión mantiene el cliente server-owned únicamente para persistir sesiones y ejecutar las operaciones backend determinísticas autorizadas.
