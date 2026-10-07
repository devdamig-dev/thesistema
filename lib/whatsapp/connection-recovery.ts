/** Only known pre-claim failures may reuse the current selection. Unknown outcomes
 * require checking persisted state, never automatically replaying a connection. */
export type ConnectionRecovery = "retry_selection" | "restart" | "check_status";
export function connectionRecovery(code: unknown, explicit?: unknown): ConnectionRecovery {
  if (explicit === "check_status" || explicit === "restart") return explicit;
  if (["provider_setup_required", "configuration_missing", "meta_unavailable", "rate_limited"].includes(String(code))) return "retry_selection";
  if (["session_unavailable", "meta_authorization_expired", "invalid_authorization", "missing_permissions", "permission_denied", "authentication_required", "phone_not_ready", "phone_not_authorized", "account_not_authorized"].includes(String(code))) return "restart";
  return "check_status";
}
