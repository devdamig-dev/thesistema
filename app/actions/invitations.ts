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
 * Flujo:
 *   1. Lookup de invitation por token (admin client, sin RLS).
 *   2. Validar status pending + no expirada.
 *   3. Buscar usuario logueado.
 *   4. Crear/actualizar business_member.
 *   5. Marcar invitation como accepted.
 *
 * Si el usuario no está logueado, devuelve `requires_auth` y la
 * página /login le pide signup/signin antes de re-disparar.
 */
export async function acceptInvitationAction(token: string): Promise<AcceptResult> {
  if (!isDatabaseMode()) {
    return { ok: true, persisted: false };
  }
  if (!token) return { ok: false, persisted: false, error: "no_token" };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "no_client" };

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return { ok: false, persisted: false, error: "requires_auth" };
  }

  const admin = createSupabaseAdminClient() as any;
  const invRes = await admin
    .from("user_invitations")
    .select("id, business_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();
  const inv = invRes.data as
    | {
        id: string;
        business_id: string;
        email: string;
        role: string;
        status: string;
        expires_at: string;
      }
    | null;

  if (!inv) return { ok: false, persisted: false, error: "invitation_not_found" };
  if (inv.status !== "pending") {
    return { ok: false, persisted: false, error: `invitation_${inv.status}` };
  }
  if (new Date(inv.expires_at) < new Date()) {
    await admin
      .from("user_invitations")
      .update({ status: "expired" })
      .eq("id", inv.id);
    return { ok: false, persisted: false, error: "invitation_expired" };
  }
  if (
    inv.email.toLowerCase() !== (user.email ?? "").toLowerCase() &&
    inv.email
  ) {
    // No bloqueamos por mismatch — el invitado puede aceptar con
    // otra cuenta. Sólo logueamos.
    console.warn(
      `[invite] email mismatch: invited ${inv.email} vs logged ${user.email}`,
    );
  }

  // Crear membership (upsert)
  const memberRes = await admin
    .from("business_members")
    .upsert(
      {
        business_id: inv.business_id,
        user_id: user.id,
        role: inv.role,
      },
      { onConflict: "business_id,user_id" },
    )
    .select("id")
    .maybeSingle();

  // Marcar invitation accepted
  await admin
    .from("user_invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", inv.id);

  await logActivity({
    businessId: inv.business_id,
    actorId: user.id,
    action: "team.invitation.accepted",
    targetType: "user_invitations",
    targetId: inv.id,
    summary: `${user.email ?? "Usuario"} aceptó la invitación como ${inv.role}.`,
  });
  await createNotification({
    businessId: inv.business_id,
    tone: "success",
    priority: "low",
    category: "system",
    title: "Nuevo miembro · invitación aceptada",
    detail: `${user.email ?? "Un usuario"} se unió como ${inv.role}.`,
    href: "/ajustes/equipo",
    source: "team",
  });

  revalidatePath("/ajustes/equipo");
  return { ok: true, persisted: true, business_id: inv.business_id };
}
