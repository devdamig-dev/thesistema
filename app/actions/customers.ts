"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission, canSeeModule } from "@/lib/permissions";
import { validateCustomerInput } from "@/lib/customers/validation";
import { saveCustomer, type CustomerSaveResult } from "@/lib/customers/service";

export async function saveCustomerAction(input: unknown): Promise<CustomerSaveResult> {
  const validated = validateCustomerInput(input);
  if (!validated.ok) return { ok: false, persisted: false, error: validated.error };
  if (!isDatabaseMode()) return { ok: false, persisted: false, error: "El modo demo no guarda clientes en la base de datos." };
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) {
    return { ok: false, persisted: false, error: "Iniciá sesión con un negocio activo para gestionar clientes." };
  }
  if (!hasPermission(ctx.role, "customers.manage") || !canSeeModule(ctx.role, "customers", ctx.enabledModules)) {
    return { ok: false, persisted: false, error: "No tenés permiso para gestionar clientes." };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "No pudimos conectar con la base de datos." };
  const result = await saveCustomer(supabase as unknown as Parameters<typeof saveCustomer>[0], ctx.businessId, validated.value);
  if (result.ok) revalidatePath("/clientes");
  return result;
}
