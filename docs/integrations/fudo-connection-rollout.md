# O1 — Fudo: conexión segura y primera importación (2026-11-03)

## Alcance implementado en este PR
- `/ajustes/integraciones/fudo` para owner/admin con sesión real, sin demo de conexión.
- Alta/rotación tras consulta real `GET /products`, test de conexión y desconexión.
- Cifrado AES-256-GCM en servidor usando AAD = `business_id` y clave de 32 bytes.
- Aislamiento multiempresa: contexto de usuario autenticado, membresía y rol revistos en servidor; las cuatro tablas Fudo no tienen grants ni policies para `anon` o `authenticated`.
- Importación únicamente GET: products, ingredients, providers, orders y sales. Una página de 100 por recurso por ejecución.
- JSON:API: `external_id`, `content_hash`, marca de origen, `connection_generation` para no mezclar fuentes tras rotar claves.
- Resumen de cantidad por recurso, última sync, códigos de error seguros.
- Tablas de staging privadas: **NO** crean ventas, pedidos, movimientos de caja ni stock en los módulos nativos.

## Requisitos de infraestructura antes de piloto real
1. Aplicar `supabase/migrations/20261103090000_fudo_pilot_read_only.sql` al proyecto Supabase correcto tras QA y respaldo/verificación de migraciones.
2. Crear secreto de 32 bytes en Base64 estándar (por ejemplo `openssl rand -base64 32`) y guardarlo en **Vercel Production / Preview** como `FUDO_CREDENTIALS_ENCRYPTION_KEY`, nunca en `NEXT_PUBLIC_*`, issues, chats ni commits.
3. Si el valor se cambia, los registros cifrados previamente no podrán recuperarse con la clave nueva. Para una futura rotación de la clave maestra se requiere proceso de recifrado versionado.
4. Confirmar que `NEXT_PUBLIC_APP_MODE=database`, Supabase Auth y `SUPABASE_SERVICE_ROLE_KEY` están activos en ese deployment.
5. Cliente: Plan Pro de Fudo, API Pública General habilitada y cuenta de servicio con permisos mínimos de lectura. Obtener `API Key` y `API Secret` **solo vía formulario HTTPS** de la UI.

## Procedimiento de verificación del piloto
1. Como owner/admin real, abrir Ajustes > Fudo. Pegar Key y Secret por formulario; comprobar que en pantalla nunca reaparezcan.
2. Conectá y validá. Registrar resultado (sin datos sensibles), request real al proveedor y timestamp.
3. Pulsar `Sincronizar datos`. Si muestra `partial`, repetir hasta completar todas las páginas. Cada repetición continúa por recurso y no duplica por `(business_id,connection_generation,resource_type,external_id)`.
4. Comparar conteos e IDs externos de la ventana importada con Fudo; revisar cobertura y permisos por recurso. Verificar casos de 401, 403, 404, 429 y 5xx con entorno controlado cuando sea posible.
5. Probar 2 empresas reales de QA separadas: owner A, empleado A, owner B; A jamás accede a secret/payload/mappings de B.
6. Repetir importación completa (cursor en página 1) y confirmar unicidad y actualización de `last_seen_at`.
7. Rotar credenciales (no mientras sincroniza) y confirmar que una nueva `connection_generation` no mezcla los registros previos.
8. Desconectar y comprobar que no se pueden hacer nuevas lecturas con la clave revocada. El staging histórico permanece privado hasta una política explícita de retención/limpieza.

## Limitaciones explícitas
- **Sin cuenta Fudo autorizada no hay validación E2E de producción.** El contrato del proveedor procede de la documentación oficial y del adapter existente. Se deben contrastar respuesta, permisos, paginación y filtros reales.
- La importación NO alimenta todavía el dashboard ni la IA de producción. Eso corresponde a la capa normalizada O2 luego de validar O1.
- No ejecuta cron ni escribe datos en Fudo. La sincronización es manual, acotada a 100 por recurso/clic, con cursor resumible; puede necesitar varias ejecuciones si el negocio tiene muchos registros.
- Si Fudo retira elementos, el staging retiene registros históricos; no interpreta ausencia como eliminación.
- No incluye E2E de dos empresas con sesiones reales ni prueba de credenciales productivas. Quality CI no equivale a estas validaciones.

**Referencia Fudo (publicada 2026-10-02):**
https://soporte.fu.do/es/articles/11939789-api-publica-de-proposito-general
