"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/data/activity";
import { assertPermission } from "@/lib/permissions/server-action";

type Result =
  | { ok: true; persisted: boolean; id?: string }
  | { ok: false; persisted: false; error: string };

async function resolveBusinessId(db: any): Promise<string | null> {
  const res = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

function refresh() {
  revalidatePath("/ajustes/equipo");
}

/**
 * Invita un usuario al business actual. Crea una fila en
 * user_invitations con un token. El envío del mail por ahora queda
 * mock — el token quedó en la fila y puede compartirse manualmente.
 */
export async function inviteUserAction(payload: {
  email: string;
  role: Role;
}): Promise<Result> {
  const guard = await assertPermission("settings.team");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await resolveBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  const me = await supabase.auth.getUser();
  const invitedBy = me.data?.user?.id ?? null;

  const res = await db
    .from("user_invitations")
    .insert({
      business_id: businessId,
      email: payload.email,
      role: payload.role,
      invited_by: invitedBy,
    })
    .select("id, token")
    .maybeSingle();
  const row = res.data as { id: string; token: string } | null;
  if (!row) {
    return { ok: false, persisted: false, error: res.error?.message ?? "invite_failed" };
  }

  await logActivity({
    businessId,
    actorId: invitedBy,
    actorRole: "admin",
    action: "team.invited",
    targetType: "user_invitations",
    targetId: row.id,
    summary: `Invitación enviada a ${payload.email} como ${payload.role}.`,
    data: { email: payload.email, role: payload.role },
  });

  refresh();
  return { ok: true, persisted: true, id: row.id };
}

/**
 * Cambia el rol de un miembro existente.
 */
export async function updateMemberRoleAction(
  memberId: string,
  role: Role,
): Promise<Result> {
  const guard = await assertPermission("settings.team");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;

  const { error } = await db
    .from("business_members")
    .update({ role })
    .eq("id", memberId);
  if (error) return { ok: false, persisted: false, error: error.message };

  refresh();
  return { ok: true, persisted: true, id: memberId };
}

/**
 * Revoca una invitación pendiente.
 */
export async function revokeInvitationAction(invitationId: string): Promise<Result> {
  const guard = await assertPermission("settings.team");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const { error } = await db
    .from("user_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);
  if (error) return { ok: false, persisted: false, error: error.message };
  refresh();
  return { ok: true, persisted: true };
}
