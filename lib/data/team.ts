/**
 * Repositorio de equipo: lista miembros y invitaciones pendientes.
 *
 * En demo mode devuelve datos mockeados del mock-data.ts existente
 * mapeados al shape canonical. En database mode lee Supabase con
 * fallback al demo si la query falla.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { Role } from "@/lib/permissions";

export type TeamMember = {
  id: string;            // business_members.id (en demo: índice)
  userId: string | null;
  fullName: string;
  email: string | null;
  role: Role;
  canApprove: boolean;
};

export type PendingInvitation = {
  id: string;
  email: string;
  role: Role;
  invitedAt: string;
  expiresAt: string;
};

const DEMO_MEMBERS: TeamMember[] = [
  { id: "demo-1", userId: null, fullName: "Mateo Iglesias", email: "mateo@labirra.com", role: "owner", canApprove: true },
  { id: "demo-2", userId: null, fullName: "Lucía Romero", email: "lucia@labirra.com", role: "manager", canApprove: true },
  { id: "demo-3", userId: null, fullName: "Juan Pérez", email: "juan@labirra.com", role: "kitchen", canApprove: false },
  { id: "demo-4", userId: null, fullName: "Mariana López", email: "mariana@labirra.com", role: "cashier", canApprove: false },
  { id: "demo-5", userId: null, fullName: "Diego Sosa", email: "diego@labirra.com", role: "kitchen", canApprove: false },
  { id: "demo-6", userId: null, fullName: "Bruno Méndez", email: "bruno@labirra.com", role: "delivery", canApprove: false },
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
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_MEMBERS;
  const db = supabase as any;
  try {
    const memberRes = await db
      .from("business_members")
      .select("id, user_id, role");
    const members = (memberRes.data as { id: string; user_id: string; role: Role }[] | null) ?? [];
    if (members.length === 0) return DEMO_MEMBERS;

    const profilesRes = await db
      .from("profiles")
      .select("id, full_name, email")
      .in(
        "id",
        members.map((m) => m.user_id),
      );
    const profiles =
      (profilesRes.data as { id: string; full_name: string; email: string | null }[] | null) ?? [];
    const byId = new Map(profiles.map((p) => [p.id, p]));

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
      };
    });
  } catch {
    return DEMO_MEMBERS;
  }
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  if (!isDatabaseMode()) return DEMO_INVITATIONS;
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_INVITATIONS;
  const db = supabase as any;
  try {
    const res = await db
      .from("user_invitations")
      .select("id, email, role, created_at, expires_at, status")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const rows =
      (res.data as { id: string; email: string; role: Role; created_at: string; expires_at: string; status: string }[] | null) ?? [];
    if (rows.length === 0) return DEMO_INVITATIONS;
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      invitedAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  } catch {
    return DEMO_INVITATIONS;
  }
}
