import { FUDO_SYNC_RESOURCES } from "./snapshot";
import type { FudoConnectionView, FudoResourcePreflight } from "./service";

export type FudoReadinessStep = {
  id: "connection" | "permissions" | "cycle" | "reconciliation";
  title: string;
  description: string;
  state: "done" | "pending" | "blocked";
};

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
  const permissionsOk = preflight?.ok === true
    && FUDO_SYNC_RESOURCES.every((resource) =>
      preflight.checks.some((check) => check.resource === resource && check.code === "available"));
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
        : preflight?.checks.length
          ? "Uno o más recursos no están disponibles. Revisá permisos, API y formato antes de importar."
          : "Ejecutá «Revisar permisos de importación»; el resultado no se conserva al recargar.",
      state: permissionsOk ? "done" : preflight?.checks.length ? "blocked" : "pending",
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
