# E2 · Proveedores manuales

## Alcance

- Gestión real en `/compras/proveedores`, accesible desde Compras.
- Alta y edición de nombre, identificación fiscal, categoría, teléfono, email, condiciones de pago y notas.
- Archivo/restauración con confirmación local, conservando IDs, compras y vínculos existentes.
- Búsqueda literal por nombre, filtros de estado y paginación de 30 proveedores.
- Últimas 30 compras visibles del proveedor con sus insumos registrados y sucursal; se respeta RLS de compras/detalles. Sin historial simulado.
- Alta rápida desde Compras usa exactamente el mismo formulario y RPC.
- No se envían mensajes a proveedores ni se realiza ninguna transacción externa.

## Persistencia y seguridad

Migración aditiva: `20261009005620_manual_suppliers.sql`. Agrega a `suppliers` únicamente `active`, `payment_terms` y `notes`.

Los tres RPC manuales son `SECURITY INVOKER`, con `search_path` vacío, sesión/perfil activo y los roles actuales `owner`, `admin` y `manager`. Las server actions derivan el negocio de la sesión; nunca aceptan negocio/actor enviados por el formulario. No se agregan políticas RLS ni se amplían permisos de tablas.

- Alta: UUID estable generado por el cliente. Repetir el mismo UUID/payload devuelve el registro original y no duplica auditoría. Un payload diferente con ese UUID falla cerrado.
- Respuesta incierta: no se informa un rollback supuesto. El formulario conserva UUID y payload por usuario/negocio en `sessionStorage`, recuperables al navegar o recargar en esa pestaña. Antes de reenviar se consulta ese ID; si aún no aparece, se puede reenviar el mismo intento de forma idempotente. Nunca se reenvía automáticamente ni se genera otro UUID para ese intento pendiente. El almacenamiento es por pestaña y dura hasta que se cierra.
- Edición/estado: bloqueo de fila y CAS con `updated_at` completo (sin truncar microsegundos); el trigger usa `greatest(clock_timestamp(), old.updated_at + interval '1 microsecond')`. Conflictos y respuestas inciertas exigen recargar datos antes de continuar.
- Auditoría: trigger privado `supplier_private.audit_supplier_change`, sin permiso de ejecución/uso para clientes, deriva actor y rol reales y escribe antes/después en `activity_logs` dentro de la misma transacción. Si falla el log, se revierte la mutación.
- Identidad del proveedor y negocio inmutables por trigger. No hay borrado físico en el flujo manual.
- Proveedores archivados siguen en el mapa histórico; los selectores de nuevas compras reciben sólo activos. Un guard SQL bloquea nuevas referencias a proveedores archivados/de otro negocio y usa `FOR SHARE` para serializar contra el archivo. Las referencias históricas sin cambios se conservan.

La relación de proveedor habitual del insumo se incorpora desde la etapa A/B (`ingredients.preferred_supplier_id`). Esta rama no agrega ni consulta esa columna antes de esa migración, y no duplica la entidad. Su historial muestra la relación real por `purchases` + `purchase_items`.

## Validación local

Dependencia de desarrollo fija: `@electric-sql/pglite@0.5.8`, con lockfile.

- `npm test`: 165 tests TypeScript pasan, incluyendo validación, roles, tenant derivado, CAS, incertidumbre, no reintento automático, consultas históricas y regresiones existentes.
- `npm run test:suppliers:sql`: pasa sobre las 53 migraciones reales en PostgreSQL aislado en memoria. Verifica alta idempotente, edición, archivo/restauración, referencias históricas, roles/RLS/tenant, perfil inactivo, privilegios del auditor, CAS monotónico y rollback total al fallar auditoría.
- Integración SQL adicional con la migración A/B de catálogo: la suite de proveedores también pasa con las 54 migraciones combinadas. La copia temporal de A/B se retiró; no se duplica en esta rama.
- `npm run typecheck`, `npm run lint` y `npm run build`: pasan.
- `git diff --check`: pasa.

PGlite no emula todo Supabase ni múltiples sesiones PostgreSQL concurrentes. La garantía de carreras proviene de los locks y constraints; resta una prueba multi-sesión en un entorno autorizado. No se ejecutó QA visual en navegador: Chromium cloud está bloqueado por el socket del entorno. No se repitieron intentos.

## Integración y publicación

1. Integrar este cambio con A/B preservando los campos nuevos en `lib/supabase/types.ts`, los scripts y la dependencia fija del runner SQL.
2. Aplicar la migración sólo cuando se autorice expresamente el entorno externo. La UI nueva debe publicarse junto a la migración.
3. Al integrar Compras con stock, conservar el filtro de proveedores activos, guard histórico y alta compartida. El contrato de la action antigua `createSupplierAction` ahora exige un UUID estable.
4. Ejecutar nuevamente tests, lint, typecheck, build y las suites SQL sobre las migraciones consolidadas.

No se publicaron commits, no se abrió PR y no se ejecutaron migraciones externas desde esta rama.
