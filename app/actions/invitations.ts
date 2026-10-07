"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { logActivity } from "@/lib/data/activity";
import { createNotification } from "@/lib/data/notifications";

type AcceptResult =
  | { ok: true; persisted: boolean; business_id?: string }
  | { ok: false; persisted: false; error: string };

/**
 * Acepta una invitación con su token.
 *
 * Frontera de seguridad:
 *   - la sesión debe pertenecer al mismo email invitado;
 *   - una invitación nunca cambia el rol de una membership existente;
 *   - no crea una segunda membership mientras no exista selector de negocio;
 *   - membership y consumo del token ocurren en una única transacción;
 *   - cualquier error de escritura falla cerrado.
 */
export async function acceptInvitationAction(token: string): Promise<AcceptResult> {
  if (!isDatabaseMode()) {
    return { ok: true, persisted: false };
  }
  if (!token) return { ok: false, persisted: false, error: "no_token" };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "no_client" };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return { ok: false, persisted: false, error: "requires_auth" };
  }

  const admin = createSupabaseAdminClient() as any;
  const rpcRes = await admin.rpc("accept_user_invitation", {
    p_token: token,
    p_user_id: user.id,
    p_email: user.email ?? "",
  });
  if (rpcRes.error) {
    console.error("[invite] atomic acceptance failed:", rpcRes.error.message);
    return { ok: false, persisted: false, error: "invitation_accept_failed" };
  }
  const accepted = rpcRes.data as
    | { ok: true; business_id: string; invitation_id: string; role: string; branch_id?: string }
    | { ok: false; error: string }
    | null;
  if (!accepted?.ok) {
    return { ok: false, persisted: false, error: accepted?.error ?? "invitation_accept_failed" };
  }

  await logActivity({
    businessId: accepted.business_id,
    actorId: user.id,
    action: "team.invitation.accepted",
    targetType: "user_invitations",
    targetId: accepted.invitation_id,
    summary: `${user.email ?? "Usuario"} aceptó la invitación como ${accepted.role}.`,
  });
  await createNotification({
    businessId: accepted.business_id,
    tone: "success",
    priority: "low",
    category: "system",
    title: "Nuevo miembro · invitación aceptada",
    detail: `${user.email ?? "Un usuario"} se unió como ${accepted.role}.`,
    href: "/ajustes/equipo",
    source: "team",
  });

  revalidatePath("/ajustes/equipo");
  return { ok: true, persisted: true, business_id: accepted.business_id };
}
