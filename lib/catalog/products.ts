/** Product creation contract shared by the manual UI and trusted transports.
 * Missing cost/category/state are never replaced with guessed catalog values.
 * Composition stays in save_recipe_atomic; unsupported fields fail closed.
 */
export type ProductInput = { name: string; category: string; price: number; cost: number; active: boolean };
export type ProductValidationIssue = { key: string; message: string; unexpected?: boolean };
export const PRODUCT_FIELDS = ["name", "category", "price", "cost", "active"] as const;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function validateProductFields(input: unknown, partial = false): { input: Partial<ProductInput>; issues: ProductValidationIssue[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input: {}, issues: [{ key: "arguments", message: "Ingresá un producto válido.", unexpected: true }] };
  const raw = input as Record<string, unknown>;
  const clean: Partial<ProductInput> = {};
  const issues: ProductValidationIssue[] = Object.keys(raw).filter(key => !(PRODUCT_FIELDS as readonly string[]).includes(key))
    .map(key => ({ key, message: ["recipe", "ingredients", "items", "composition"].includes(key) ? "La composición se edita desde Productos; esta operación no acepta recetas ni insumos." : "El producto contiene campos no permitidos.", unexpected: true }));
  for (const key of PRODUCT_FIELDS) {
    const value = raw[key];
    if (partial && value === undefined) continue;
    if (key === "name" || key === "category") {
      const max = key === "name" ? 200 : 100;
      if (typeof value !== "string" || !value.trim() || value.length > max) issues.push({ key, message: key === "name" ? "Ingresá el nombre del producto (hasta 200 caracteres)." : "Ingresá una categoría (hasta 100 caracteres)." });
      else clean[key] = value.trim();
    } else if (key === "active") {
      if (typeof value !== "boolean") issues.push({ key, message: "Elegí un estado válido: activo o inactivo." });
      else clean.active = value;
    } else {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9999999999.99) issues.push({ key, message: key === "price" ? "Ingresá un precio válido." : "Ingresá un costo explícito válido." });
      else clean[key] = value;
    }
  }
  return { input: clean, issues };
}

export type ProductCreationContext = { businessId: string; source: "manual" } | { businessId: string; source: "whatsapp"; actorId: string };
export type ProductCreationResult = { ok: true; persisted: true; productId: string; source: "manual" | "whatsapp" }
  | { ok: false; persisted: false | "unknown"; error: string };
type ProductDatabase = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }> };

export async function createCatalogProduct(db: ProductDatabase, context: ProductCreationContext, raw: unknown): Promise<ProductCreationResult> {
  const validated = validateProductFields(raw);
  if (validated.issues.length) return { ok: false, persisted: false, error: validated.issues[0].message };
  if (!uuid(context.businessId) || !["manual", "whatsapp"].includes(context.source) || context.source === "whatsapp" && !uuid(context.actorId)) return { ok: false, persisted: false, error: "No pudimos identificar el negocio o el actor." };
  let response: { data: unknown; error: any };
  try {
    response = await db.rpc("create_product_atomic", {
      p_business_id: context.businessId,
      p_input: validated.input,
      // Manual actor is derived only from auth.uid() inside the transaction.
      p_actor_id: context.source === "whatsapp" ? context.actorId : null,
    });
  } catch {
    return { ok: false, persisted: "unknown", error: "No pudimos confirmar el alta. Revisá Productos antes de repetirla para evitar duplicados." };
  }
  if (response?.error) {
    const rejected = typeof response.error.code === "string" && /^(?:(?:22|23|42)[0-9A-Z]{3}|P0001)$/.test(response.error.code);
    return { ok: false, persisted: rejected ? false : "unknown", error: rejected
      ? "No se guardó el producto. Revisá sus datos y tus permisos."
      : "No pudimos confirmar el alta. Revisá Productos antes de repetirla para evitar duplicados." };
  }
  const result = response?.data as Record<string, unknown> | null;
  if (!result || result.ok !== true || !uuid(result.id) || result.source !== context.source || !uuid(result.actor_id)
    || context.source === "whatsapp" && result.actor_id !== context.actorId) return { ok: false, persisted: "unknown", error: "La respuesta no confirma el alta. Revisá Productos antes de repetirla para evitar duplicados." };
  return { ok: true, persisted: true, productId: result.id, source: context.source };
}
