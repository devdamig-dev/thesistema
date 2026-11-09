import { FUDO_SYNC_RESOURCES } from "./snapshot";
import type { FudoConnectionView, FudoResourcePreflight } from "./service";

export type FudoReadinessStep = {
  id: "connection" | "permissions" | "cycle" | "reconciliation";
  title: string;
  description: string;
  state: "done" | "pending" | "blocked";
};

/** A probe is valid only for one server-derived tenant, generation and test revision. */
export function fudoConnectionRevision(view: Pick<FudoConnectionView, "status" | "connectionRevision">): string | null {
  return view.status === "connected" && typeof view.connectionRevision === "string"
    && /^[a-f0-9]{64}$/.test(view.connectionRevision) ? view.connectionRevision : null;
}

export function selectCurrentFudoPreflight(
  view: Pick<FudoConnectionView, "status" | "connectionRevision">,
  stored: { revision: string; result: FudoResourcePreflight } | null,
): FudoResourcePreflight | null {
  const revision = fudoConnectionRevision(view);
  return revision !== null && stored?.revision === revision ? stored.result : null;
}

/**
 * The five-resource provider probe must be internally consistent before its
 * result can influence readiness or be copied into the private pilot record.
 * A duplicate, omitted, unknown or contradictory status is not five verified
 * GETs. This is a defensive boundary for any malformed API/UI state.
 */
const FUDO_PREFLIGHT_CODES = new Set([
  "available", "forbidden", "invalid_credentials", "api_unavailable",
  "rate_limited", "provider_unavailable", "invalid_response",
]);

export function isWellFormedFudoPreflight(probe: FudoResourcePreflight | null): boolean {
  if (!probe || typeof probe.ok !== "boolean" || !Array.isArray(probe.checks)
    || probe.checks.length !== FUDO_SYNC_RESOURCES.length) return false;

  const seen = new Set<string>();
  for (const check of probe.checks) {
    if (!check || typeof check.resource !== "string" || typeof check.code !== "string"
      || !FUDO_SYNC_RESOURCES.some((resource) => resource === check.resource)
      || !FUDO_PREFLIGHT_CODES.has(check.code) || seen.has(check.resource)) return false;
    seen.add(check.resource);
  }
  return seen.size === FUDO_SYNC_RESOURCES.length
    && probe.ok === probe.checks.every((check) => check.code === "available");
}

/**
 * Advisory readiness only: never turn a product probe or synthetic CI run into
 * a claim that a real Fudo account, tenant isolation or counts were validated.
 * The server never persists diagnostic credentials or browser-derived approval.
 */
export function evaluateFudoPilotReadiness(
  view: FudoConnectionView,
  preflight: FudoResourcePreflight | null = null,
): FudoReadinessStep[] {
  const connectionOk = view.status === "connected";
  // A successful probe belongs to the connection that was active when it ran.
  // Never show a green permission check if the connection is now disconnected or invalid.
  const malformedPreflight = connectionOk && preflight !== null && !isWellFormedFudoPreflight(preflight);
  const currentPreflight = connectionOk && !malformedPreflight ? preflight : null;
  const permissionsOk = currentPreflight?.ok === true;
  // A legacy or interrupted cursor can say "0" without a stable scan UUID.
  // The server exposes a null seen-count for such a cursor: it is NOT a
  // reconciliable full cycle even when the newest run says "completed".
  // Empty resources legitimately have a seen-count of zero.
  const cycleComplete = connectionOk && view.lastSyncStatus === "completed"
    && view.recentRuns[0]?.status === "completed"
    && FUDO_SYNC_RESOURCES.every((resource) => {
      const seen = view.seenThisCycleCounts[resource];
      return view.nextPages[resource] === 0
        && typeof seen === "number" && Number.isSafeInteger(seen) && seen >= 0;
    });

  return [
    {
      id: "connection",
      title: "Conexión segura",
      description: connectionOk
        ? "Credenciales guardadas y consulta de productos validada; esto no confirma los otros recursos."
        : "Conectá una cuenta Fudo autorizada y completá el test de conexión.",
      state: connectionOk ? "done" : view.status === "error" ? "blocked" : "pending",
    },
    {
      id: "permissions",
      title: "Diagnóstico de los cinco recursos",
      description: permissionsOk
        ? "Los cinco GET de muestra respondieron correctamente en esta sesión."
        : malformedPreflight
          ? "El diagnóstico es inconsistente o incompleto. Volvé a revisar los cinco recursos."
          : currentPreflight?.checks.length
            ? "Uno o más recursos no están disponibles. Revisá permisos, API y formato antes de importar."
            : "Ejecutá «Revisar permisos de importación»; el resultado no se conserva al recargar.",
      state: permissionsOk ? "done" : malformedPreflight || currentPreflight?.checks.length ? "blocked" : "pending",
    },
    {
      id: "cycle",
      title: "Primera lectura completa",
      description: cycleComplete
        ? "Los cinco cursores terminaron y la última ejecución cerró correctamente; falta conciliar los datos."
        : "Sincronizá los cinco recursos hasta completar los cursores y verificar su ciclo de origen.",
      state: cycleComplete ? "done" : view.lastSyncStatus === "failed" ? "blocked" : "pending",
    },
    {
      id: "reconciliation",
      title: "Conciliación y QA multiempresa",
      description: "Pendiente de validar conteos e IDs con Fudo real, sesiones owner/empleado y aislamiento A/B. Requiere evidencia manual del piloto.",
      state: "pending",
    },
  ];
}
