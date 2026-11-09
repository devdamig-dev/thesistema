import { FUDO_SYNC_RESOURCES } from "./snapshot";
import { isWellFormedFudoPreflight, selectCurrentFudoPreflight } from "./readiness";
import type { FudoConnectionView, FudoResourcePreflight } from "./service";

/**
 * Copy-only, non-authoritative pilot worksheet.
 *
 * This report is built from the already-authorized server view and an optional
 * same-revision, in-memory permission probe. Never include connectionRevision,
 * business/user/external IDs, payloads, ciphertext, tokens or raw error strings.
 * No new API request or persistence is performed by the export.
 */
const RESOURCE_LABELS: Record<string, string> = {
  products: "Productos",
  ingredients: "Ingredientes",
  providers: "Proveedores",
  orders: "Pedidos",
  sales: "Ventas",
};

const PROBE_LABELS: Record<string, string> = {
  available: "GET compatible",
  forbidden: "Sin permiso",
  invalid_credentials: "Credenciales rechazadas",
  api_unavailable: "API/recurso no disponible",
  rate_limited: "Límite de consultas",
  provider_unavailable: "Proveedor no disponible",
  invalid_response: "Formato incompatible",
};

function safeCount(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value) : "No verificable";
}

function safePage(value: unknown, cycleClosed: boolean): string {
  // A legacy or interrupted progress row can hold next_page=0 without a
  // committed full scan. Cursor exhaustion is not proof of a completed cycle.
  if (value === 0) return cycleClosed ? "Ciclo leído" : "Cursor 0 sin cierre verificable";
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100000) {
    return `Página ${value} pendiente`;
  }
  return "Sin iniciar/no verificable";
}

function safeDate(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "No registrada";
  return new Date(value).toISOString();
}

function safeConnectionStatus(status: FudoConnectionView["status"]): string {
  return status === "connected" ? "Conexión validada parcialmente"
    : status === "error" ? "Requiere revisión" : "Sin conexión";
}

function safeSyncStatus(status: string | null): string {
  switch (status) {
    case "completed": return "Última tanda completada (sin conciliación)";
    case "partial": return "Páginas pendientes";
    case "failed": return "Última tanda fallida";
    case "running": return "En curso";
    default: return "No verificado";
  }
}

/**
 * Creates an intentionally limited, copyable worksheet for the private pilot.
 * Numeric zero is only presented when the authorized server has actually
 * returned zero; missing or malformed metrics are NOT reported as zero.
 */
export function buildFudoPilotEvidence(
  view: FudoConnectionView,
  storedProbe: { revision: string; result: FudoResourcePreflight } | null,
  generatedAt: Date = new Date(),
): string {
  const currentProbe = selectCurrentFudoPreflight(view, storedProbe);
  const probeChecks = currentProbe?.checks ?? [];
  // The readiness checklist and private evidence must use the same strict
  // five-resource contract; malformed diagnostics never become green checks.
  const trustworthyProbe = isWellFormedFudoPreflight(currentProbe);

  const latestRunClosed = view.lastSyncStatus === "completed"
    && view.recentRuns[0]?.status === "completed";
  const rows = FUDO_SYNC_RESOURCES.map((resource) => {
    const probe = trustworthyProbe ? probeChecks.find((check) => check.resource === resource) : null;
    const seen = view.seenThisCycleCounts[resource];
    const cycleClosed = latestRunClosed
      && typeof seen === "number" && Number.isSafeInteger(seen) && seen >= 0;
    return `| ${RESOURCE_LABELS[resource]} | ${probe ? PROBE_LABELS[probe.code] : "Sin diagnóstico vigente"} | ${safeCount(view.importedCounts[resource])} | ${safeCount(seen)} | ${safeCount(view.possiblyMissingCounts[resource])} | ${safePage(view.nextPages[resource], cycleClosed)} |`;
  });

  return [
    "# GastroPilot O1 — resumen técnico de lectura (NO-GO)",
    `Generado (UTC): ${generatedAt.toISOString()}`,
    "Origen: Ajustes > Integraciones > Fudo; metadatos de la sesión autorizada.",
    "Este resumen NO acredita paridad, permisos de escritura, aislamiento A/B ni piloto validado.",
    `Conexión: ${safeConnectionStatus(view.status)}.`,
    `Última prueba de conexión: ${safeDate(view.lastTestedAt)}.`,
    `Última sincronización: ${safeDate(view.lastSyncedAt)}.`,
    `Estado: ${safeSyncStatus(view.lastSyncStatus)}.`,
    "",
    "| Recurso | GET de muestra | Guardados históricos | Vistos en ciclo | Posibles ausencias | Cursor |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    "Pendientes para GO: cuenta Fudo autorizada; conteos e IDs conciliados contra el origen; dos ciclos idempotentes; sesiones QA independientes y aislamiento A/B; acta y aceptación del responsable.",
    "No incluir este resumen en un repositorio público si los conteos comerciales son confidenciales. No contiene claves, tokens, payloads ni IDs.",
  ].join("\n");
}
