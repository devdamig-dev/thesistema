import { ConnectionError, metaId, type ConnectionActor, type ReportRequest } from "./signup";

/** Audit only. This function cannot create sessions, subscribe accounts or execute tools. */
export async function persistSignupDiagnostic(db: any, actor: ConnectionActor, input: ReportRequest, config: { appId: string; configId: string }) {
  // Re-read active membership: a cached page/context is not sufficient for a write.
  const membership = await db.from("business_members").select("role").eq("business_id", actor.businessId).eq("user_id", actor.userId).maybeSingle();
  if (membership.error || !["owner", "admin"].includes(membership.data?.role)) throw new ConnectionError("permission_denied", "No pudimos confirmar tus permisos para registrar el diagnóstico.", 403);
  const result = await db.from("activity_logs").insert({
    business_id: actor.businessId, actor_id: actor.userId, actor_role: membership.data.role,
    action: "whatsapp.signup.reported_error", target_type: "whatsapp",
    summary: "Error de conexión a Meta reportado desde el navegador; requiere diagnóstico",
    data: { source: "browser_report_unverified", mode: input.mode, configured_app_id: metaId(config.appId) ? config.appId : null, configured_login_id: metaId(config.configId) ? config.configId : null, ...input.diagnostic },
  }).select("id").single();
  if (result.error || !result.data?.id) throw new ConnectionError("diagnostic_not_saved", "No pudimos guardar el diagnóstico. Conservá la referencia que aparece en pantalla.", 503);
  return { ok: true as const, phase: "diagnostic_saved" as const };
}
