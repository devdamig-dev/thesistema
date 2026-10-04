"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";
import { BUSINESS_WIDE_ROLES, hasPermission } from "@/lib/permissions";

type Result =
  | { ok: true; persisted: boolean; id?: string; inviteUrl?: string; branchAssigned?: boolean }
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
  branchId?: string;
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
  let branchId: string | null = null;

  if (!BUSINESS_WIDE_ROLES.includes(payload.role)) {
    const branchQuery = db
      .from("branches")
      .select("id")
      .eq("business_id", businessId);
    const branchRes = payload.branchId
      ? await branchQuery.eq("id", payload.branchId).maybeSingle()
      : await branchQuery.eq("is_main", true).maybeSingle();
    branchId = (branchRes.data as { id: string } | null)?.id ?? null;
    if (branchRes.error || !branchId) {
      return { ok: false, persisted: false, error: "branch_required" };
    }
  }

  const res = await db
    .from("user_invitations")
    .insert({
      business_id: businessId,
      email: payload.email,
      role: payload.role,
      branch_id: branchId,
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
    data: { email: payload.email, role: payload.role, branchId },
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

  const rpcRes = await db.rpc("update_member_role_with_branch", {
    p_member_id: memberId,
    p_business_id: ctx.businessId,
    p_role: role,
  });
  if (rpcRes.error) {
    console.error("[team] atomic role update failed", rpcRes.error.message);
    return { ok: false, persisted: false, error: "role_update_failed" };
  }
  const result = rpcRes.data as
    | { ok: true; member_id: string; old_role: Role; role: Role; branch_assigned: boolean }
    | { ok: false; error: string }
    | null;
  if (!result?.ok) {
    return { ok: false, persisted: false, error: result?.error ?? "role_update_failed" };
  }

  await logActivity({
    businessId: ctx.businessId!,
    actorId: ctx.userId,
    actorRole: ctx.role,
    action: "team.role.updated",
    targetType: "business_members",
    targetId: result.member_id,
    summary: `Rol actualizado de ${result.old_role} a ${result.role}.`,
    data: { oldRole: result.old_role, role: result.role, branchAssigned: result.branch_assigned },
  });

  refresh();
  return {
    ok: true,
    persisted: true,
    id: memberId,
    branchAssigned: result.branch_assigned,
  };
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
