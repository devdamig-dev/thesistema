/**
 * Resolución del usuario actual y su contexto (business, rol, módulos
 * habilitados, sucursales asignadas).
 *
 * Funciona en demo mode devolviendo un contexto "owner" con todos los
 * módulos visibles y sin restricción de sucursales.
 *
 * Sólo server-side.
 */

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { ModuleKey, Role } from "@/lib/permissions";

/** Roles válidos — para validar la cookie de demo. */
const VALID_ROLES: Role[] = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "marketing",
  "employee",
  "kitchen",
  "cashier",
  "waiter",
  "delivery",
  "viewer",
];

export type UserContext = {
  isAuthenticated: boolean;
  userId: string | null;
  businessId: string | null;
  fullName: string;
  email: string | null;
  role: Role;
  enabledModules: ModuleKey[] | null;
  /**
   * IDs de sucursales asignadas al usuario.
   *
   *   - null  → sin restricción (owner, admin, manager) → ve TODAS.
   *   - []    → sin sucursales asignadas (employee nuevo) → no ve nada.
   *   - [...] → sólo esas sucursales.
   */
  assignedBranchIds: string[] | null;
};

const DEMO_CONTEXT: UserContext = {
  isAuthenticated: false,
  userId: null,
  businessId: null,
  fullName: "Mateo Iglesias",
  email: "mateo@labirra.com",
  role: "owner",
  enabledModules: null,
  assignedBranchIds: null,
};

/** Roles "sin restricción" — ven TODAS las sucursales. */
const UNRESTRICTED_ROLES: Role[] = ["owner", "admin", "manager", "accountant"];

function readDemoRoleCookie(): Role | null {
  try {
    const value = cookies().get("gp_demo_role")?.value;
    if (!value) return null;
    return (VALID_ROLES as string[]).includes(value) ? (value as Role) : null;
  } catch {
    return null;
  }
}

export async function getCurrentUserContext(): Promise<UserContext> {
  if (!isDatabaseMode()) {
    // En demo, permitimos overridear el rol con la cookie gp_demo_role
    // (seteada vía /api/dev/role?as=...). Útil para QA del sidebar
    // adaptativo y el middleware guard.
    const override = readDemoRoleCookie();
    if (override) {
      return { ...DEMO_CONTEXT, role: override };
    }
    return DEMO_CONTEXT;
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_CONTEXT;
  const db = supabase as any;

  const userRes = await supabase.auth.getUser();
  const user = userRes.data?.user;
  if (!user) return DEMO_CONTEXT;

  const profileRes = await db
    .from("profiles")
    .select("full_name, email, organization_id")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileRes.data as
    | { full_name: string; email: string | null; organization_id: string | null }
    | null;

  const memberRes = await db
    .from("business_members")
    .select("id, business_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const member = memberRes.data as
    | { id: string; business_id: string; role: Role }
    | null;
  if (!member) {
    return {
      isAuthenticated: true,
      userId: user.id,
      businessId: null,
      fullName: profile?.full_name ?? user.email ?? "Usuario",
      email: profile?.email ?? user.email ?? null,
      role: "viewer",
      enabledModules: null,
      assignedBranchIds: [],
    };
  }

  const modsRes = await db
    .from("business_modules")
    .select("module_key, enabled")
    .eq("business_id", member.business_id)
    .eq("enabled", true);
  const mods = (modsRes.data as { module_key: ModuleKey; enabled: boolean }[] | null) ?? [];

  // Branch assignments — sólo aplican a roles restringidos.
  let assignedBranchIds: string[] | null = null;
  if (!UNRESTRICTED_ROLES.includes(member.role)) {
    const baRes = await db
      .from("branch_assignments")
      .select("branch_id")
      .eq("business_member_id", member.id);
    const branches = (baRes.data as { branch_id: string }[] | null) ?? [];
    assignedBranchIds = branches.map((b) => b.branch_id);
  }

  return {
    isAuthenticated: true,
    userId: user.id,
    businessId: member.business_id,
    fullName: profile?.full_name ?? user.email ?? "Usuario",
    email: profile?.email ?? user.email ?? null,
    role: member.role,
    enabledModules: mods.length ? mods.map((m) => m.module_key) : null,
    assignedBranchIds,
  };
}
