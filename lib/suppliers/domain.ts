export type SupplierFields = {
  name: string;
  taxId?: string;
  category?: string;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  notes?: string;
};
export type SupplierCreateInput = SupplierFields & { id: string };
export type SupplierUpdateInput = SupplierFields & { id: string; expectedUpdatedAt: string };
export type SupplierRow = {
  id: string;
  name: string;
  tax_id: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  payment_terms: string | null;
  notes: string | null;
  active: boolean;
  updated_at: string;
};
export type SupplierMutationResult =
  | { ok: true; persisted: true; id: string; supplier: SupplierRow }
  | { ok: false; persisted: false | null; error: string; status: "rejected" | "conflict" | "uncertain" };

const limits: Record<keyof SupplierFields, number> = {
  name: 200, taxId: 40, category: 120, phone: 40, email: 254, paymentTerms: 1000, notes: 4000,
};
export const isSupplierId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isSupplierVersion = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function validateSupplierFields(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Ingresá los datos del proveedor.";
  const values = input as Record<string, unknown>;
  for (const [key, max] of Object.entries(limits)) {
    const value = values[key];
    if (value === undefined && key !== "name") continue;
    if (typeof value !== "string") return "Revisá los datos del proveedor.";
    if (value.trim().length > max) return `El campo ${fieldLabels[key as keyof SupplierFields]} admite hasta ${max} caracteres.`;
    const multiline = key === "notes" || key === "paymentTerms";
    // Reject control characters; notes and terms may contain line breaks/tabs.
    if ([...value].some((c) => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && !(multiline && [9, 10, 13].includes(n))); })) return "Quitá los caracteres de control de los datos.";
  }
  if (!(values.name as string).trim()) return "Ingresá el nombre del proveedor.";
  const email = (values.email as string | undefined)?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Ingresá un email válido.";
  const phone = (values.phone as string | undefined)?.trim();
  if (phone && (!/^[+0-9(). /-]+$/.test(phone) || !/^\d{3,20}$/.test(phone.replace(/\D/g, "")))) return "Ingresá un teléfono válido (entre 3 y 20 dígitos).";
  return null;
}
export const fieldLabels: Record<keyof SupplierFields, string> = {
  name: "Nombre", taxId: "CUIT / identificación fiscal", category: "Categoría", phone: "Teléfono", email: "Email", paymentTerms: "Condiciones de pago", notes: "Notas",
};
export const supplierFieldLimits = limits;
export function normalizeSupplierFields(input: SupplierFields): Required<SupplierFields> {
  return Object.fromEntries(Object.keys(limits).map((key) => [key, input[key as keyof SupplierFields]?.trim() ?? ""])) as Required<SupplierFields>;
}
export function supplierRpcFields(input: SupplierFields) {
  const value = normalizeSupplierFields(input);
  return { p_name: value.name, p_tax_id: value.taxId || null, p_category: value.category || null,
    p_phone: value.phone || null, p_email: value.email || null, p_payment_terms: value.paymentTerms || null, p_notes: value.notes || null };
}
export function supplierToFields(row: SupplierRow): SupplierFields {
  return { name: row.name, taxId: row.tax_id ?? "", category: row.category ?? "", phone: row.phone ?? "", email: row.email ?? "", paymentTerms: row.payment_terms ?? "", notes: row.notes ?? "" };
}
export function supplierError(error: { code?: string; message?: string } | null): SupplierMutationResult {
  if (error?.message?.includes("supplier_stale_version")) return { ok: false, persisted: false, status: "conflict", error: "Otra persona cambió este proveedor. Recargá sus datos antes de guardar." };
  if (error?.message?.includes("supplier_request_conflict")) return { ok: false, persisted: false, status: "conflict", error: "Este intento ya corresponde a un proveedor registrado. Verificá el resultado antes de volver a cargarlo." };
  if (["42501", "P0002", "23514", "22023", "22P02", "22007"].includes(error?.code ?? "")) return { ok: false, persisted: false, status: "rejected", error: error?.code === "42501" ? "Tu usuario no tiene permiso para modificar este proveedor." : "No se guardaron cambios. Revisá los datos y que el proveedor siga disponible." };
  return { ok: false, persisted: null, status: "uncertain", error: "No pudimos confirmar el resultado. Verificá los datos guardados antes de continuar." };
}
export type SupplierListData = { suppliers: SupplierRow[]; count: number; page: number; pageSize: number; canManage: boolean; draftScope: string };
export type SupplierHistory = { id: string; purchasedAt: string; branch: string; total: number; items: { description: string; quantity: number; unit: string | null; ingredient: string | null }[] };
