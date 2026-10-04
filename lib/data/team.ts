/**
 * Repositorio de equipo: lista miembros y invitaciones pendientes.
 *
 * En demo mode devuelve datos mockeados del mock-data.ts existente
 * mapeados al shape canonical. En database mode lee Supabase con
 * aislamiento explícito al negocio del contexto autenticado.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { hasPermission } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";

export type TeamMember = {
  id: string;            // business_members.id (en demo: índice)
  userId: string | null;
  fullName: string;
  email: string | null;
  role: Role;
  canApprove: boolean;
  branchIds: string[];
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: Role;
  invitedAt: string;
  expiresAt: string;
};

export type TeamBranch = {
  id: string;
  name: string;
  isMain: boolean;
};

const DEMO_BRANCHES: TeamBranch[] = [
  { id: "demo-main", name: "Palermo", isMain: true },
];

const DEMO_MEMBERS: TeamMember[] = [
  { id: "demo-1", userId: null, fullName: "Mateo Iglesias", email: "mateo@labirra.com", role: "owner", canApprove: true, branchIds: [] },
  { id: "demo-2", userId: null, fullName: "Lucía Romero", email: "lucia@labirra.com", role: "manager", canApprove: true, branchIds: [] },
  { id: "demo-3", userId: null, fullName: "Juan Pérez", email: "juan@labirra.com", role: "kitchen", canApprove: false, branchIds: ["demo-main"] },
  { id: "demo-4", userId: null, fullName: "Mariana López", email: "mariana@labirra.com", role: "cashier", canApprove: false, branchIds: ["demo-main"] },
  { id: "demo-5", userId: null, fullName: "Diego Sosa", email: "diego@labirra.com", role: "kitchen", canApprove: false, branchIds: ["demo-main"] },
  { id: "demo-6", userId: null, fullName: "Bruno Méndez", email: "bruno@labirra.com", role: "delivery", canApprove: false, branchIds: ["demo-main"] },
];

const DEMO_INVITATIONS: PendingInvitation[] = [
  {
    id: "inv-demo-1",
    email: "florencia@labirra.com",
    role: "marketing",
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
  },
];

export async function listTeamMembers(): Promise<TeamMember[]> {
  if (!isDatabaseMode()) return DEMO_MEMBERS;
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !hasPermission(ctx.role, "settings.team")) return [];
  const supabase = createSupabaseServerClient();
  if (!supabase) return [];
  const db = supabase as any;
  try {
    const memberRes = await db
      .from("business_members")
      .select("id, user_id, role")
      .eq("business_id", ctx.businessId);
    const members = (memberRes.data as { id: string; user_id: string; role: Role }[] | null) ?? [];
    if (memberRes.error) throw memberRes.error;
    if (members.length === 0) return [];

    const profilesRes = await db
      .from("profiles")
      .select("id, full_name, email")
      .in(
        "id",
        members.map((m) => m.user_id),
      );
    if (profilesRes.error) throw profilesRes.error;
    const profiles =
      (profilesRes.data as { id: string; full_name: string; email: string | null }[] | null) ?? [];
    const byId = new Map(profiles.map((p) => [p.id, p]));

    const assignmentsRes = await db
      .from("branch_assignments")
      .select("business_member_id, branch_id")
      .in(
        "business_member_id",
        members.map((m) => m.id),
      );
    if (assignmentsRes.error) throw assignmentsRes.error;
    const assignments =
      (assignmentsRes.data as Array<{ business_member_id: string; branch_id: string }> | null) ?? [];
    const branchesByMember = new Map<string, string[]>();
    for (const assignment of assignments) {
      const branchIds = branchesByMember.get(assignment.business_member_id) ?? [];
      branchIds.push(assignment.branch_id);
      branchesByMember.set(assignment.business_member_id, branchIds);
    }

    return members.map((m) => {
      const p = byId.get(m.user_id);
      const role = m.role;
      const canApprove = ["owner", "admin", "manager", "accountant"].includes(role);
      return {
        id: m.id,
        userId: m.user_id,
        fullName: p?.full_name ?? "Usuario",
        email: p?.email ?? null,
        role,
        canApprove,
        branchIds: branchesByMember.get(m.id) ?? [],
      };
    });
  } catch (error) {
    console.error("[team] members query failed", error);
    return [];
  }
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  if (!isDatabaseMode()) return DEMO_INVITATIONS;
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !hasPermission(ctx.role, "settings.team")) return [];
  const supabase = createSupabaseServerClient();
  if (!supabase) return [];
  const db = supabase as any;
  try {
    const res = await db
      .from("user_invitations")
      .select("id, email, role, created_at, expires_at, status")
      .eq("business_id", ctx.businessId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (res.error) throw res.error;
    const rows =
      (res.data as { id: string; email: string; role: Role; created_at: string; expires_at: string; status: string }[] | null) ?? [];
    if (rows.length === 0) return [];
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      invitedAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  } catch (error) {
    console.error("[team] invitations query failed", error);
    return [];
  }
}

export async function listTeamBranches(): Promise<TeamBranch[]> {
  if (!isDatabaseMode()) return DEMO_BRANCHES;
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !hasPermission(ctx.role, "settings.team")) return [];
  const supabase = createSupabaseServerClient();
  if (!supabase) return [];
  const db = supabase as any;
  try {
    const res = await db
      .from("branches")
      .select("id, name, is_main")
      .eq("business_id", ctx.businessId)
      .order("is_main", { ascending: false })
      .order("name");
    if (res.error) throw res.error;
    return ((res.data ?? []) as Array<{ id: string; name: string; is_main: boolean }>).map((branch) => ({
      id: branch.id,
      name: branch.name,
      isMain: branch.is_main,
    }));
  } catch (error) {
    console.error("[team] branches query failed", error);
    return [];
  }
}
