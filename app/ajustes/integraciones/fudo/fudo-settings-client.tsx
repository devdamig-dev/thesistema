"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, DatabaseZap, PlugZap, RefreshCcw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ajustes/setting-row";
import type { FudoConnectionView, FudoResourcePreflight } from "@/lib/integrations/fudo/service";
import type { FudoSyncResource } from "@/lib/integrations/fudo/snapshot";
import { bindCurrentFudoPreflight, evaluateFudoPilotReadiness, formatVerifiedFudoCount, fudoCursorDisplay, isWellFormedFudoPreflight, selectCurrentFudoPreflight } from "@/lib/integrations/fudo/readiness";
import { buildFudoPilotEvidence } from "@/lib/integrations/fudo/pilot-evidence";
import { runFudoActionSafely, runFudoPreflightSafely, runFudoSyncBatches } from "@/lib/integrations/fudo/action-feedback";
import {
  connectFudoAction, testFudoConnectionAction, inspectFudoPermissionsAction, disconnectFudoAction, syncFudoAction,
} from "@/app/actions/fudo";

const LABELS: Record<string, string> = {
  products: "Productos", ingredients: "Ingredientes", providers: "Proveedores",
  orders: "Pedidos", sales: "Ventas",
};

const ACCESS_LABELS: Record<string, string> = {
  available: "Lectura disponible",
  forbidden: "Sin permiso",
  invalid_credentials: "Credenciales rechazadas",
  api_unavailable: "API o recurso no disponible",
  rate_limited: "Límite de consultas",
  provider_unavailable: "Sin respuesta de Fudo",
  invalid_response: "Formato incompatible",
};

export function FudoSettingsClient({ status }: { status: FudoConnectionView }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [working, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [evidenceNotice, setEvidenceNotice] = useState<string | null>(null);
  // The permission probe is advisory and applies only to the tested connection.
  // A server refresh after retest/rotation must not re-use old green checks.
  const [preflightState, setPreflightState] = useState<{
    revision: string; result: FudoResourcePreflight;
  } | null>(null);
  const preflight = selectCurrentFudoPreflight(status, preflightState);
  const malformedPreflight = preflight !== null && !isWellFormedFudoPreflight(preflight);
  const visiblePreflight = malformedPreflight ? null : preflight;
  const connected = status.status === "connected";
  const hasCredentials = status.status !== "disconnected";
  const readiness = evaluateFudoPilotReadiness(status, preflight);

  const execute = (action: () => Promise<{ ok: boolean; message: string }>, clear = false) => {
    setNotice(null);
    setPreflightState(null);
    startTransition(async () => {
      const result = await runFudoActionSafely(action);
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok && clear) { setKey(""); setSecret(""); }
      router.refresh();
    });
  };

  const copyPilotEvidence = async () => {
    // A manual clipboard action: no Fudo GET, no external upload and no local
    // persistence. The formatter only includes sanitized server-side counts.
    try {
      await navigator.clipboard.writeText(buildFudoPilotEvidence(status, preflightState));
      setEvidenceNotice("Resumen técnico copiado. Pegalo únicamente en el acta privada del piloto.");
    } catch {
      setEvidenceNotice("No se pudo copiar el resumen. Revisá los permisos del portapapeles y reintentá.");
    }
  };

  const executeBoundedSync = () => {
    setNotice(null);
    setPreflightState(null);
    startTransition(async () => {
      // Pin every foreground batch to the exact tenant/credential revision
      // rendered before starting. Never silently switch to another business.
      const result = await runFudoSyncBatches(
        () => syncFudoAction(status.connectionRevision ?? ""),
      );
      setNotice({ ok: result.ok, message: result.message });
      // Reread persisted cursors and logs even if a later batch failed.
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <SettingsCard
        title="Vinculación con Fudo"
        description="Traé información real del negocio para probar GastroPilot, sin modificar lo que operás en Fudo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${connected
            ? "border-success-500/40 text-success-400"
            : status.status === "error" ? "border-warn-500/40 text-warn-400" : "border-line text-ink-muted"}`}>
            {connected ? "Conexión validada" : hasCredentials ? "Requiere revisión" : "Sin conexión"}
          </span>
          <span className="text-xs text-ink-muted">
            {status.lastTestedAt ? `Última prueba: ${new Date(status.lastTestedAt).toLocaleString("es-AR")}` : "Sin prueba registrada"}
          </span>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-bg-subtle/40 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-brand-400" />
            {hasCredentials ? "Reemplazar credenciales (rotación)" : "Conectar cuenta Fudo"}
          </div>
          <p className="mb-4 text-xs leading-relaxed text-ink-muted">
            En Fudo con Plan Pro, activá la API Pública General desde «Aplicaciones externas &gt; API Pública General».
            Después, en «Administración &gt; Usuarios», creá un usuario exclusivo para la integración con
            permisos mínimos de lectura para productos, ingredientes, proveedores, pedidos y ventas.
            Generá su API Key y API Secret; copiá el secreto cuando Fudo lo muestre, porque no podrás recuperarlo.
            Pegá ambas claves únicamente acá: GastroPilot las envía al servidor y las guarda cifradas;
            nunca las vuelve a mostrar ni las incluye en los registros de sincronización.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-ink-muted">
              API Key
              <input aria-label="API Key Fudo" value={key} onChange={(event) => setKey(event.target.value)}
                type="password" autoComplete="off" spellCheck={false} disabled={working}
                className="mt-1 w-full rounded-lg border border-line bg-bg-elevated p-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
                placeholder="Pegá tu API Key" />
            </label>
            <label className="block text-xs text-ink-muted">
              API Secret
              <input aria-label="API Secret Fudo" value={secret} onChange={(event) => setSecret(event.target.value)}
                type="password" autoComplete="off" spellCheck={false} disabled={working}
                className="mt-1 w-full rounded-lg border border-line bg-bg-elevated p-3 text-sm text-ink focus:border-brand-500 focus:outline-none"
                placeholder="Pegá tu API Secret" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={working || key.trim().length < 8 || secret.trim().length < 8}
              onClick={() => execute(() => connectFudoAction({ apiKey: key, apiSecret: secret }), true)}>
              <PlugZap className="h-4 w-4" /> {working ? "Procesando…" : hasCredentials ? "Validar y reemplazar" : "Conectar y validar"}
            </Button>
            {hasCredentials && <Button disabled={working} onClick={() => execute(testFudoConnectionAction)}>
              <RefreshCcw className="h-4 w-4" /> Probar conexión
            </Button>}
            {connected && <Button disabled={working} onClick={() => execute(async () => {
              const result = await runFudoPreflightSafely(inspectFudoPermissionsAction);
              // A second administrator may rotate credentials BEFORE this
              // request starts, while this browser still renders the old
              // revision. Never attribute the server's new five GETs to that
              // older connection, even for a moment before router.refresh().
              if (result.checks.length > 0) {
                if (!isWellFormedFudoPreflight(result)) {
                  return { ok: false, message: "El diagnóstico fue inconsistente. Volvé a revisar los cinco recursos." };
                }
                const bound = bindCurrentFudoPreflight(status, result);
                if (!bound) {
                  return { ok: false, message: "La conexión Fudo cambió desde que abriste esta pantalla. Actualizá y revisá los permisos nuevamente." };
                }
                setPreflightState(bound);
              }
              return result;
            })}>
              <ShieldCheck className="h-4 w-4" /> Revisar permisos de importación
            </Button>}
          </div>
        </div>
        {notice && (
          <p role="status" className={`mt-4 rounded-xl border p-3 text-sm ${notice.ok
            ? "border-success-500/30 text-success-400" : "border-warn-500/30 text-warn-400"}`}>
            {notice.message}
          </p>
        )}
        {malformedPreflight && (
          <p role="alert" className="mt-3 rounded-xl border border-warn-500/30 p-3 text-xs text-warn-400">
            El diagnóstico de Fudo es incompleto o inconsistente. Volvé a revisar los cinco recursos.
          </p>
        )}
        {visiblePreflight && visiblePreflight.checks.length > 0 && (
          <div className="mt-3 rounded-xl border border-line p-4" aria-live="polite">
            <p className="mb-3 text-xs font-semibold text-ink">Lectura por recurso (sin importar datos)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {visiblePreflight.checks.map(({ resource, code }) => (
                <p key={resource} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink">{LABELS[resource] ?? resource}</span>
                  <span className={code === "available" ? "text-success-400" : "text-warn-400"}>
                    {ACCESS_LABELS[code] ?? "Error de lectura"}
                  </span>
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Esta comprobación sólo lee una página de muestra por recurso; no confirma totales ni reemplaza la conciliación del piloto.
            </p>
          </div>
        )}
        <p className="mt-4 text-xs text-ink-muted">
          <a href="https://soporte.fu.do/es/articles/11939789-api-publica-de-proposito-general"
            target="_blank" rel="noreferrer" className="text-brand-400 underline">
            Cómo habilitar la API Pública General en Fudo
          </a>
        </p>
      </SettingsCard>

      <SettingsCard title="Preparación del piloto Fudo" description="Control de avance para probar GastroPilot sin modificar la operación actual.">
        <p className="mb-3 rounded-lg border border-warn-500/30 px-3 py-2 text-xs font-semibold text-warn-400">
          Piloto NO-GO hasta conciliar datos reales y aprobar el aislamiento multiempresa.
        </p>
        <div className="space-y-2" aria-label="Checklist del piloto Fudo">
          {readiness.map((step) => (
            <div key={step.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{step.title}</p>
                <span className={`text-xs font-semibold ${step.state === "done" ? "text-success-400" : step.state === "blocked" ? "text-warn-400" : "text-ink-muted"}`}>
                  {step.state === "done" ? "Comprobación parcial" : step.state === "blocked" ? "Requiere revisión" : "Pendiente"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{step.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Los pasos técnicos son orientativos. Ningún indicador automático certifica por sí mismo
          la prueba con Fudo real, los conteos conciliados ni la autorización para reemplazar Fudo.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={working} onClick={() => { void copyPilotEvidence(); }}>
            <ClipboardCopy className="h-4 w-4" /> Copiar resumen técnico para el acta
          </Button>
          <p className="text-xs text-ink-muted">
            Sólo metadatos y conteos de este negocio; conservá el resumen en el acta privada.
          </p>
        </div>
        {evidenceNotice && <p role="status" className="mt-2 text-xs text-ink-muted">{evidenceNotice}</p>}
      </SettingsCard>

      <SettingsCard title="Importación de lectura" description="Importamos por páginas con ID externo y origen, sin cargar ventas, pedidos o stock como movimientos nativos.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs text-ink-muted">Última sincronización</p>
            <p className="mt-2 text-sm font-semibold text-ink">
              {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("es-AR") : "Sin ejecutar"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{status.lastSyncStatus === "partial" ? "Hay más páginas por importar"
              : status.lastSyncStatus === "completed" ? "Última tanda completada"
                : status.lastSyncStatus === "failed" ? "La última tanda tuvo un error" : "No hay resultados verificados"}</p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-xs text-ink-muted">Última tanda por tipo</p>
            <div className="mt-2 space-y-1">
              {Object.entries(LABELS).map(([code, label]) => (
                <p key={code} className="flex justify-between gap-2 text-xs text-ink">
                  <span>{label}</span><span className="tabular-nums">{status.lastCounts[code] ?? "—"}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-line p-4">
          <p className="text-xs font-semibold text-ink">Conciliación preliminar de registros</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Guardados incluye registros históricos que podrían haber desaparecido de Fudo.
            Vistos corresponde al ciclo de lectura actual; las posibles ausencias se muestran
            solamente cuando ese recurso completó todas sus páginas. Ninguna ausencia se elimina automáticamente.
          </p>
          <div className="mt-3 space-y-3">
            {Object.entries(LABELS).map(([code, label]) => {
              const seen = status.seenThisCycleCounts[code];
              const missing = status.possiblyMissingCounts[code];
              return (
                <div key={code} className="rounded-lg border border-line/60 p-3 text-xs text-ink">
                  <p className="mb-2 font-semibold">{label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div><p className="text-ink-muted">Guardados</p><p className="tabular-nums">{formatVerifiedFudoCount(status.importedCounts[code])}</p></div>
                    <div><p className="text-ink-muted">Vistos en ciclo</p><p className="tabular-nums">{formatVerifiedFudoCount(seen)}</p></div>
                    <div><p className="text-ink-muted">Posibles ausencias</p><p className="tabular-nums">{typeof missing === "number" ? missing.toLocaleString("es-AR") : "Pendiente"}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-line p-4">
          <p className="text-xs font-semibold text-ink">Paginación de la importación actual</p>
          <p className="mt-1 text-xs text-ink-muted">
            Cada recurso conserva su avance. Una página completada no equivale a datos conciliados contra Fudo.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(LABELS).map(([resource, label]) => {
              const cursor = fudoCursorDisplay(status, resource as FudoSyncResource);
              return (
                <p key={resource} className="flex justify-between gap-2 text-xs text-ink">
                  <span>{label}</span>
                  <span className={cursor.verified ? "text-success-400" : "text-ink-muted"}>
                    {cursor.label}
                  </span>
                </p>
              );
            })}
          </div>
        </div>
        {status.recentRuns.length > 0 && (
          <div className="mt-3 rounded-lg border border-line p-4">
            <p className="mb-3 text-xs font-semibold text-ink">Últimas cinco ejecuciones</p>
            <div className="space-y-2">
              {status.recentRuns.map((run, index) => (
                <div key={run.startedAt + index} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2 text-xs last:border-0 last:pb-0">
                  <span className="text-ink">{new Date(run.startedAt).toLocaleString("es-AR")}</span>
                  <span className="text-ink-muted">{run.status === "completed" ? "Completada" : run.status === "partial" ? "Parcial" : run.status === "failed" ? "Fallida" : "En curso"}</span>
                  <span className="tabular-nums text-ink-muted">
                    {Object.values(run.counts).reduce((sum, n) => sum + n, 0).toLocaleString("es-AR")} registros en tanda
                  </span>
                  {run.errorCode && <span className="text-warn-400">Error: {run.errorCode}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {status.lastErrorCode && <p className="mt-3 text-xs text-warn-400">
          Último error identificado: {status.lastErrorCode}
        </p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!connected || working}
            onClick={executeBoundedSync}>
            <DatabaseZap className="h-4 w-4" /> {working ? "Sincronizando…" : "Sincronizar datos"}
          </Button>
          {status.lastSyncStatus === "partial" && <span className="text-xs text-ink-muted">
            Si quedan páginas después de cinco tandas, volvé a sincronizar para continuar.
          </span>}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Cada clic continúa hasta cinco tandas read-only con cursores persistidos; se detiene ante un error
          o una respuesta incierta. No se alteran ventas, pedidos ni stock de Fudo.
        </p>
      </SettingsCard>

      {hasCredentials && <SettingsCard title="Desconectar" description="Elimina las credenciales y detiene nuevas lecturas. Conserva los registros históricos importados para auditoría privada.">
        <Button variant="outline" disabled={working}
          onClick={() => {
            if (window.confirm("¿Desconectar Fudo y eliminar las credenciales guardadas?")) {
              execute(disconnectFudoAction, true);
            }
          }}>
          <Unplug className="h-4 w-4" /> Desconectar Fudo
        </Button>
      </SettingsCard>}
    </div>
  );
}
