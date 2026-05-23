/**
 * Resolución del usuario actual y su contexto (business, rol, módulos
 * habilitados). Funciona en demo mode devolviendo un contexto "owner"
 * para que todos los módulos sean visibles.
 *
 * Sólo server-side.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { ModuleKey, Role } from "@/lib/permissions";

export type UserContext = {
  isAuthenticated: boolean;
  userId: string | null;
  businessId: string | null;
  fullName: string;
  email: string | null;
  role: Role;
  enabledModules: ModuleKey[] | null;
};

const DEMO_CONTEXT: UserContext = {
  isAuthenticated: false,
  userId: null,
  businessId: null,
  fullName: "Mateo Iglesias",
  email: "mateo@labirra.com",
  role: "owner",
  enabledModules: null,
};

export async function getCurrentUserContext(): Promise<UserContext> {
  if (!isDatabaseMode()) return DEMO_CONTEXT;
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_CONTEXT;
  const db = supabase as any;

  // 1) Usuario logueado
  const userRes = await supabase.auth.getUser();
  const user = userRes.data?.user;
  if (!user) return DEMO_CONTEXT;

  // 2) Profile + organization
  const profileRes = await db
    .from("profiles")
    .select("full_name, email, organization_id")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileRes.data as
    | { full_name: string; email: string | null; organization_id: string | null }
    | null;

  // 3) Membership al business (tomamos el primero)
  const memberRes = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const member = memberRes.data as { business_id: string; role: Role } | null;
  if (!member) {
    return {
      isAuthenticated: true,
      userId: user.id,
      businessId: null,
      fullName: profile?.full_name ?? user.email ?? "Usuario",
      email: profile?.email ?? user.email ?? null,
      role: "viewer",
      enabledModules: null,
    };
  }

  // 4) Módulos habilitados del business
  const modsRes = await db
    .from("business_modules")
    .select("module_key, enabled")
    .eq("business_id", member.business_id)
    .eq("enabled", true);
  const mods = (modsRes.data as { module_key: ModuleKey; enabled: boolean }[] | null) ?? [];

  return {
    isAuthenticated: true,
    userId: user.id,
    businessId: member.business_id,
    fullName: profile?.full_name ?? user.email ?? "Usuario",
    email: profile?.email ?? user.email ?? null,
    role: member.role,
    enabledModules: mods.length ? mods.map((m) => m.module_key) : null,
  };
}
