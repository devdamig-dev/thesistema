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
 *   - la invitación sólo se marca accepted después de persistir la membership;
 *   - cualquier error de escritura falla cerrado.
 */
export async function acceptInvitationAction(token: string): Promise<AcceptResult> {
  if (!isDatabaseMode()) {
    return { ok: true, persisted: false };
  }
  if (!token) return { ok: false, persisted: false, error: "no_token" };

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "no_client" };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return { ok: false, persisted: false, error: "requires_auth" };
  }

  const admin = createSupabaseAdminClient() as any;
  const invRes = await admin
    .from("user_invitations")
    .select("id, business_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (invRes.error) {
    console.error("[invite] lookup failed:", invRes.error.message);
    return { ok: false, persisted: false, error: "invitation_lookup_failed" };
  }

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
    const expireRes = await admin
      .from("user_invitations")
      .update({ status: "expired" })
      .eq("id", inv.id)
      .eq("status", "pending");
    if (expireRes.error) {
      console.error("[invite] could not mark expired:", expireRes.error.message);
    }
    return { ok: false, persisted: false, error: "invitation_expired" };
  }

  const invitedEmail = inv.email.trim().toLowerCase();
  const authenticatedEmail = (user.email ?? "").trim().toLowerCase();
  if (!invitedEmail || !authenticatedEmail || invitedEmail !== authenticatedEmail) {
    console.warn(
      `[invite] blocked email mismatch: invited ${invitedEmail || "<empty>"} vs logged ${authenticatedEmail || "<empty>"}`,
    );
    return { ok: false, persisted: false, error: "invitation_email_mismatch" };
  }

  // No usar upsert: aceptar una invitación no debe poder subir, bajar ni
  // reemplazar el rol de una membership que ya existe.
  const existingRes = await admin
    .from("business_members")
    .select("id, role")
    .eq("business_id", inv.business_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingRes.error) {
    console.error("[invite] membership lookup failed:", existingRes.error.message);
    return { ok: false, persisted: false, error: "membership_lookup_failed" };
  }

  if (existingRes.data) {
    return { ok: false, persisted: false, error: "already_member" };
  }

  const memberRes = await admin
    .from("business_members")
    .insert({
      business_id: inv.business_id,
      user_id: user.id,
      role: inv.role,
    })
    .select("id")
    .maybeSingle();

  if (memberRes.error || !memberRes.data) {
    console.error("[invite] membership create failed:", memberRes.error?.message ?? "missing row");
    return { ok: false, persisted: false, error: "membership_create_failed" };
  }

  const acceptedAt = new Date().toISOString();
  const acceptRes = await admin
    .from("user_invitations")
    .update({ status: "accepted", accepted_at: acceptedAt })
    .eq("id", inv.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (acceptRes.error || !acceptRes.data) {
    console.error("[invite] invitation state update failed:", acceptRes.error?.message ?? "missing row");
    // Compensación: no dejar una membership activa si no pudimos consumir el token.
    const rollbackRes = await admin
      .from("business_members")
      .delete()
      .eq("id", memberRes.data.id)
      .eq("user_id", user.id)
      .eq("business_id", inv.business_id);
    if (rollbackRes.error) {
      console.error("[invite] membership compensation failed:", rollbackRes.error.message);
    }
    return { ok: false, persisted: false, error: "invitation_accept_failed" };
  }

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
