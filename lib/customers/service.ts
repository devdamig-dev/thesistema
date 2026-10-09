import { validateCustomerInput } from "./validation";

type CustomerDatabase = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };
export type CustomerSaveResult = { ok: true; persisted: true; id: string } | { ok: false; persisted: false | "unknown"; error: string };
const ERRORS: Record<string, string> = {
  permission_denied: "No tenés permiso para gestionar clientes en este negocio.",
  customer_not_found: "El cliente ya no está disponible en este negocio.",
  customer_conflict: "Otra persona modificó este cliente. Cerrá el formulario y recargá antes de volver a editar.",
  invalid_customer: "Revisá los datos del cliente.",
};
/** Shared domain entry point. Tenant comes from the authenticated server context;
 * the invoker RPC independently checks current membership, role and RLS. */
export async function saveCustomer(db: CustomerDatabase, businessId: string, input: unknown): Promise<CustomerSaveResult> {
  const validated = validateCustomerInput(input);
  if (!validated.ok) return { ok: false, persisted: false, error: validated.error };
  try {
    const res = await db.rpc("save_customer_atomic", { p_business_id: businessId, p_input: validated.value });
    const result = res.data as { ok?: boolean; id?: string; error?: string } | null;
    if (res.error || result?.ok !== true || typeof result.id !== "string") {
      return { ok: false, persisted: !res.error && result?.ok === false ? false : "unknown", error: ERRORS[result?.error ?? ""] ?? "No pudimos guardar el cliente. Recargá la lista para comprobar su estado antes de reintentar." };
    }
    return { ok: true, persisted: true, id: result.id };
  } catch {
    return { ok: false, persisted: "unknown", error: "Se interrumpió la conexión. Recargá la lista para comprobar si se guardó antes de reintentar." };
  }
}
