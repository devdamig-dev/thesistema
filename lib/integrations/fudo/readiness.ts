import { FUDO_SYNC_RESOURCES, type FudoSyncResource } from "./snapshot";
import { parseStrictFudoTimestamp } from "./timestamp";
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
  // Do not trust only the client-side wrapper revision: a legacy/corrupted
  // state could label a probe from another business or a rotated credential
  // generation as current. Require the revision returned by the server and
  // the complete five-resource contract before showing permission evidence.
  return revision !== null && stored?.revision === revision
    && stored.result?.connectionRevision === revision
    && isWellFormedFudoPreflight(stored.result)
    ? stored.result : null;
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
 * The server may probe generation B after this browser rendered generation A.
 * Never attach those five permissions to the stale revision captured by UI.
 * The response must identify the exact credential generation that was read.
 */
export function bindCurrentFudoPreflight(
  view: Pick<FudoConnectionView, "status" | "connectionRevision">,
  probe: FudoResourcePreflight,
): { revision: string; result: FudoResourcePreflight } | null {
  const revision = fudoConnectionRevision(view);
  return revision && probe.connectionRevision === revision && isWellFormedFudoPreflight(probe)
    ? { revision, result: probe } : null;
}

/**
 * A completed label alone is not proof that a read cycle was durably closed.
 * The SQL finish RPC writes run.finished_at and connection.last_synced_at in
 * one transaction. Fail closed for legacy/inconsistent metadata instead of
 * turning five cursor zeroes into a falsely verified full scan.
 */
export function hasVerifiableFudoRunClosure(
  view: Pick<FudoConnectionView, "status" | "lastSyncStatus" | "lastSyncedAt" | "recentRuns">,
): boolean {
  const run = view.recentRuns[0];
  if (view.status !== "connected" || view.lastSyncStatus !== "completed"
    || run?.status !== "completed") return false;
  // SQL writes zoned RFC3339 instants. Date.parse would also accept impossible
  // calendar dates or local-time strings, yielding a false green closure.
  const startedAt = parseStrictFudoTimestamp(run.startedAt);
  const finishedAt = parseStrictFudoTimestamp(run.finishedAt);
  const lastSyncedAt = parseStrictFudoTimestamp(view.lastSyncedAt);
  return startedAt !== null && finishedAt !== null && lastSyncedAt !== null
    && finishedAt >= startedAt && lastSyncedAt >= finishedAt;
}


type FudoCycleView = Pick<FudoConnectionView,
  "status" | "lastSyncStatus" | "lastSyncedAt" | "recentRuns" | "nextPages" | "seenThisCycleCounts">;

/**
 * A zero cursor proves only that pagination reached an end marker. A green
 * "Ciclo leído" additionally requires an auditable run close and a current
 * cycle marker (including a legitimate zero-count resource) for all five
 * resources. Keep the settings UI and the pilot readiness gate in sync.
 */
export function hasVerifiableFudoFullCycle(view: FudoCycleView): boolean {
  return hasVerifiableFudoRunClosure(view)
    && FUDO_SYNC_RESOURCES.every((resource) => {
      const seen = view.seenThisCycleCounts[resource];
      return view.nextPages[resource] === 0
        && typeof seen === "number" && Number.isSafeInteger(seen) && seen >= 0;
    });
}

export function fudoCursorDisplay(view: FudoCycleView, resource: FudoSyncResource): {
  label: string; verified: boolean;
} {
  const page = view.nextPages[resource];
  if (page === 0) {
    const verified = hasVerifiableFudoFullCycle(view);
    return { label: verified ? "Ciclo leído" : "Cursor 0 sin cierre verificable", verified };
  }
  if (typeof page === "number" && Number.isSafeInteger(page) && page >= 1 && page <= 100000) {
    return { label: `Pendiente: página ${page}`, verified: false };
  }
  return { label: "Sin iniciar", verified: false };
}

/** A missing or malformed HEAD/count is not evidence of zero imported records. */
export function formatVerifiedFudoCount(count: unknown): string {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count.toLocaleString("es-AR") : "No verificable";
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
  // Readiness is also called outside the UI wrapper. A five-for-five probe
  // is advisory only for the exact tenant/credential test revision read from
  // the server; a stale or unbound result must never turn the badge green.
  const revision = fudoConnectionRevision(view);
  const validPreflight = revision !== null && preflight?.connectionRevision === revision
    && isWellFormedFudoPreflight(preflight);
  const malformedPreflight = connectionOk && preflight !== null && !validPreflight;
  const currentPreflight = validPreflight ? preflight : null;
  const permissionsOk = currentPreflight?.ok === true;
  // A legacy or interrupted cursor can say "0" without a stable scan UUID.
  // The server exposes a null seen-count for such a cursor: it is NOT a
  // reconciliable full cycle even when the newest run says "completed".
  // Empty resources legitimately have a seen-count of zero.
  const cycleComplete = hasVerifiableFudoFullCycle(view);

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
