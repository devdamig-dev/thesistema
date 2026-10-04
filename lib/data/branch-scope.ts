/**
 * Applies the branch scope already resolved for the authenticated actor to a
 * query executed with the Supabase service role. Service-role clients bypass
 * RLS, so callers must add this filter explicitly.
 */
export function applyAdminBranchScope(query: any, branchIds: string[] | null) {
  if (branchIds === null) return query;
  if (branchIds.length === 0) {
    return query.in("branch_id", ["00000000-0000-0000-0000-000000000000"]);
  }
  return query.or(`branch_id.in.(${branchIds.join(",")}),branch_id.is.null`);
}
