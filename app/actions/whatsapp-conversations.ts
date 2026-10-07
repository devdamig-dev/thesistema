"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { authorizeConnectionActor, ConnectionError } from "@/lib/whatsapp/signup";
import { parseConversationInput } from "@/lib/whatsapp/conversation-input";

export async function saveWhatsAppConversation(input: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    if (!isDatabaseMode()) throw new ConnectionError("demo_mode", "La demostración no autoriza conversaciones reales.");
    const actor = authorizeConnectionActor(await getCurrentUserContext());
    const value = parseConversationInput(input);
    const db = createSupabaseAdminClient() as any;
    const result = await db.rpc("set_whatsapp_member_conversation", { p_business_id: actor.businessId, p_actor_id: actor.userId, p_member_id: value.memberId, p_branch_id: value.branchId, p_enabled: value.enabled, p_phone: value.phone });
    if (result.error) {
      const message = String(result.error.message ?? "");
      if (/phone_ambiguous/.test(message)) throw new ConnectionError("phone_ambiguous", "Ese teléfono está asociado a más de una identidad. Revisá el equipo antes de autorizarlo.");
      if (/profile_phone_change_requires_review/.test(message)) throw new ConnectionError("phone_change", "La persona ya tiene otro teléfono registrado. Ese cambio de identidad requiere una revisión; no se reemplazó automáticamente.");
      if (/branch_not_authorized|member_not_found|permission_denied/.test(message)) throw new ConnectionError("permission_denied", "La persona o la sucursal no pertenecen al alcance autorizado de este negocio.", 403);
      if (/whatsapp_not_connected/.test(message)) throw new ConnectionError("not_connected", "Primero vinculá la cuenta de WhatsApp del negocio.");
      throw new ConnectionError("conversation_failed", "No pudimos guardar la autorización. No se confirmó ningún cambio.", 503);
    }
    revalidatePath("/ajustes/whatsapp");
    return { ok: true, message: value.enabled ? "Conversación autorizada. La persona conserva sus permisos y sucursales del equipo." : "Conversación pausada. Sus mensajes ya no se procesarán por este canal." };
  } catch (error) { return { ok: false, message: error instanceof ConnectionError ? error.message : "No pudimos completar la autorización." }; }
}
