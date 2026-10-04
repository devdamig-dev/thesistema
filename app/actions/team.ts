"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";
import { hasPermission } from "@/lib/permissions";

type Result =
  | { ok: true; persisted: boolean; id?: string; inviteUrl?: string }
  | { ok: false; persisted: false; error: string };

function refresh() {
  revalidatePath("/ajustes/equipo");
}

/**
 * Invita un usuario al business actual. Crea una fila en
 * user_invitations con un token y devuelve el enlace para compartir.
 */
export async function inviteUserAction(payload: {
  email: string;
  role: Role;
}): Promise<Result> {
  const ctx = await getCurrentUserContext();
  if (!hasPermission(ctx.role, "settings.team")) {
    return { ok: false, persisted: false, error: "forbidden" };
  }
  if (isDatabaseMode() && (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId)) {
    return { ok: false, persisted: false, error: "no_business" };
  }
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "connection_unavailable" };
  const db = supabase as any;
  const businessId = ctx.businessId!;
  const invitedBy = ctx.userId;

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
    actorRole: ctx.role,
    action: "team.invited",
    targetType: "user_invitations",
    targetId: row.id,
    summary: `Invitación enviada a ${payload.email} como ${payload.role}.`,
    data: { email: payload.email, role: payload.role },
  });

  refresh();
  return {
    ok: true,
    persisted: true,
    id: row.id,
    inviteUrl: `/login?invite_token=${encodeURIComponent(row.token)}&next=${encodeURIComponent("/")}`,
  };
}

/**
 * Cambia el rol de un miembro existente.
 */
export async function updateMemberRoleAction(
  memberId: string,
  role: Role,
): Promise<Result> {
  const ctx = await getCurrentUserContext();
  if (!hasPermission(ctx.role, "settings.team")) {
    return { ok: false, persisted: false, error: "forbidden" };
  }
  if (isDatabaseMode() && (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId)) {
    return { ok: false, persisted: false, error: "no_business" };
  }
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "connection_unavailable" };
  const db = supabase as any;

  const { data, error } = await db
    .from("business_members")
    .update({ role })
    .eq("id", memberId)
    .eq("business_id", ctx.businessId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, persisted: false, error: error.message };
  if (!data) return { ok: false, persisted: false, error: "not_found" };

  refresh();
  return { ok: true, persisted: true, id: memberId };
}

/**
 * Revoca una invitación pendiente.
 */
export async function revokeInvitationAction(invitationId: string): Promise<Result> {
  const ctx = await getCurrentUserContext();
  if (!hasPermission(ctx.role, "settings.team")) {
    return { ok: false, persisted: false, error: "forbidden" };
  }
  if (isDatabaseMode() && (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId)) {
    return { ok: false, persisted: false, error: "no_business" };
  }
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "connection_unavailable" };
  const db = supabase as any;
  const { data, error } = await db
    .from("user_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("business_id", ctx.businessId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, persisted: false, error: error.message };
  if (!data) return { ok: false, persisted: false, error: "not_found" };
  refresh();
  return { ok: true, persisted: true };
}
