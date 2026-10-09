# Operación manual y composición del catálogo

## Primer incremento: Productos / Insumos / Composición

La interfaz de gestión no depende de conectar WhatsApp. Productos conserva su alta,
edición y estado activo; Insumos y Composición incorporan operaciones persistidas
sobre `ingredients`, `products`, `recipes`, `recipe_items` y `stock_items` existentes.
No se crea un segundo catálogo ni se cargan datos de ejemplo en database mode.

- El catálogo es compartido por negocio. Sólo owner/admin lo modifican, igual que
  las políticas y permisos existentes. Las existencias y mínimos se filtran por
  sucursal autorizada.
- Insumos admite alta, edición, archivado, unidad base, costo actual, proveedor
  habitual y mínimos por sucursal. Archivar conserva historial y referencias.
- La existencia actual es de lectura en este editor. Se modifica mediante
  movimientos desde Stock; guardar un mínimo no cambia la existencia.
- Composición permite varios insumos y cantidades positivas por unidad de producto.
  Se convierte kg↔g y l↔ml. Unidad/u/unidad/unidades son equivalentes de conteo.
  No se infieren pesos de porciones, densidades, paquetes ni cantidades del texto
  histórico `qty`.
- Una composición vacía es válida: no genera consumo teórico y conserva el último
  costo como base manual editable. Productos con composición completa derivan el
  costo de las cantidades y costos actuales; el formulario no lo sobrescribe.
- Líneas históricas sin cantidad/unidad requieren revisión. No se recalculan como
  cero y la UI excluye esos productos de indicadores de margen calculable.
- Los costos de insumos se conservan con seis decimales. El costo total del producto
  se redondea una vez a centavos. Margen bruto es `(precio-costo)/precio`; precio
  cero no tiene porcentaje de margen calculable.

## Contrato de dominio y persistencia

`lib/recipes/quantities.ts` es el dominio puro para validación y preview. Las
operaciones persistidas son RPCs invoker compartibles por futuras interfaces:

- `save_ingredient_atomic`: catálogo + mínimos dentro de una transacción.
- `save_recipe_atomic`: reemplazo validado completo, bloqueo por negocio/producto,
  token optimista `updated_at` y costo derivado.
- `recalc_product_recipe_cost`: recálculo desde datos actuales bajo transacción;
  responde con costos previos/nuevos observados en esa verificación, sin proyecciones ficticias.
  Los triggers actualizan costos dentro de la operación original; la verificación
  posterior a una factura no declara alertas ni atribuye esos deltas a la factura.

Los IDs de negocio se resuelven del contexto autenticado en las server actions.
Los RPCs y triggers vuelven a comprobar tenant, relaciones, unidad y permisos.
Las políticas existentes no se amplían. El único SECURITY DEFINER agregado es el
sink de auditoría en esquema privado, invocable sólo por triggers y sin capacidad
de escribir el catálogo. Sus logs se revierten junto con la operación si falla.

El modo database falla explícitamente frente a lecturas o persistencia fallidas.
Las consultas de catálogo paginan y rechazan un resultado incompleto. Los servicios
no generan cantidades de venta, confianza ni impacto monetario inventados.

## Instalación y verificación

Aplicar primero la migración `20261009001349_catalog_recipe_quantities.sql` mediante
el proceso de release autorizado, antes de publicar código que consulta sus columnas.
Es aditiva en los campos y conserva `qty` legado. Revisar constraints/triggers frente
al esquema del destino. No ejecutar el seed demo contra una base operativa.

Pruebas reproducibles:

- `npm test`: regresiones TypeScript, acciones/roles/aislamiento y handlers de UI.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run test:db:catalog`: PostgreSQL/PGlite efímero, migraciones reales del repo,
  RLS, permisos y prueba transaccional con rollback. Sin conexión a Supabase real.
- `npm run test:ui:catalog`: Chromium con componentes reales y acciones fixture
  aisladas. Requiere `npx playwright install --with-deps chromium`.

El workflow Quality usa permisos de lectura, no persiste credenciales de checkout
ni recibe secretos, y conserva capturas de los fixtures por siete días. Las pruebas
con handlers simulados no sustituyen Chromium; PGlite de una conexión no certifica
contención entre múltiples sesiones PostgreSQL. El E2E autenticado contra Supabase
requiere una base de prueba separada autorizada.

## Alcance siguiente, todavía independiente

Ventas manuales y consumo teórico; compras con líneas/entradas de stock; motivos e
historial completo de Stock; edición/anulación de Gastos y Compras; Proveedores y
Clientes; corrección manual de Facturas; cronogramas/cuotas de Deudas y pagos con
imputación explícita. UI, Inbox, WhatsApp y OCR deberán converger en los mismos
servicios y mantener el origen. Este incremento no declara entregados esos módulos.
