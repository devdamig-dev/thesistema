"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";

export async function deleteMyAccountAction(confirmation: string) {
  if (!isDatabaseMode()) {
    return { ok: false as const, error: "database_required" };
  }
  if (confirmation.trim() !== "ELIMINAR MI CUENTA") {
    return { ok: false as const, error: "confirmation_mismatch" };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, error: "connection_unavailable" };
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user) return { ok: false as const, error: "requires_auth" };

  const admin = createSupabaseAdminClient() as any;
  const memberships = await admin
    .from("business_members")
    .select("business_id,role")
    .eq("user_id", user.id);

  if (memberships.error) {
    console.error("[account] memberships lookup failed", memberships.error.message);
    return { ok: false as const, error: "account_check_failed" };
  }

  for (const membership of memberships.data ?? []) {
    if (membership.role !== "owner") continue;
    const owners = await admin
      .from("business_members")
      .select("id", { count: "exact", head: true })
      .eq("business_id", membership.business_id)
      .eq("role", "owner");
    if (owners.error) {
      console.error("[account] owner count failed", owners.error.message);
      return { ok: false as const, error: "account_check_failed" };
    }
    if ((owners.count ?? 0) <= 1) {
      return { ok: false as const, error: "sole_owner_business" };
    }
  }

  const deleted = await admin.auth.admin.deleteUser(user.id);
  if (deleted.error) {
    console.error("[account] auth deletion failed", deleted.error.message);
    return { ok: false as const, error: "delete_failed" };
  }

  // Clear the browser session as well. A deleted auth row must not leave a
  // still-present access-token cookie that makes the UI look authenticated.
  const signedOut = await supabase.auth.signOut();
  if (signedOut.error) {
    console.error("[account] local session cleanup failed", signedOut.error.message);
  }

  return { ok: true as const };
}
