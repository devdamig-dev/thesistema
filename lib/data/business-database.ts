import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getCurrentUserContext } from "./auth";
import { mapBusiness } from "./mappers";

type Tables = Database["public"]["Tables"];

/**
 * Database-mode business adapter.
 *
 * The tenant must come from getCurrentUserContext(), which already fails closed
 * when the authenticated account has zero or multiple memberships. Never pick
 * a business with limit(1): doing so would reintroduce arbitrary tenant
 * selection outside the middleware boundary.
 */
export const databaseBusiness = {
  async getCurrent() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return null;

    const ctx = await getCurrentUserContext();
    if (!ctx.isAuthenticated || !ctx.businessId) return null;

    const businessId = ctx.businessId;

    const bizRes = await supabase
      .from("businesses")
      .select("name, organization_id")
      .eq("id", businessId)
      .maybeSingle();
    const biz = bizRes.data as Pick<Tables["businesses"]["Row"], "name" | "organization_id"> | null;
    if (bizRes.error || !biz) return null;

    const [orgRes, branchRes] = await Promise.all([
      supabase
        .from("organizations")
        .select("name, plan")
        .eq("id", biz.organization_id)
        .maybeSingle(),
      supabase
        .from("branches")
        .select("address")
        .eq("business_id", businessId)
        .eq("is_main", true)
        .limit(1)
        .maybeSingle(),
    ]);

    const org = orgRes.data as Pick<Tables["organizations"]["Row"], "name" | "plan"> | null;
    const branch = branchRes.data as Pick<Tables["branches"]["Row"], "address"> | null;
    if (orgRes.error || !org) return null;

    return mapBusiness(
      { name: org.name, plan: org.plan },
      { name: biz.name },
      branchRes.error ? null : branch,
      ctx.fullName || ctx.email || "—",
    );
  },
};
