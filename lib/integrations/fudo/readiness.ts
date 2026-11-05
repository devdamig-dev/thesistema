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
  const currentPreflight = connectionOk ? preflight : null;
  const permissionsOk = currentPreflight?.ok === true
    && FUDO_SYNC_RESOURCES.every((resource) =>
      currentPreflight.checks.some((check) => check.resource === resource && check.code === "available"));
  const cycleComplete = connectionOk && view.lastSyncStatus === "completed"
    && view.recentRuns[0]?.status === "completed"
    && FUDO_SYNC_RESOURCES.every((resource) => view.nextPages[resource] === 0);

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
        : currentPreflight?.checks.length
          ? "Uno o más recursos no están disponibles. Revisá permisos, API y formato antes de importar."
          : "Ejecutá «Revisar permisos de importación»; el resultado no se conserva al recargar.",
      state: permissionsOk ? "done" : currentPreflight?.checks.length ? "blocked" : "pending",
    },
    {
      id: "cycle",
      title: "Primera lectura completa",
      description: cycleComplete
        ? "Los cinco cursores terminaron y la última ejecución cerró correctamente; falta conciliar los datos."
        : "Sincronizá y reanudá las páginas pendientes hasta completar los cinco recursos sin errores.",
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
