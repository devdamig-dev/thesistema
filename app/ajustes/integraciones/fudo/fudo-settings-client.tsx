"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap, PlugZap, RefreshCcw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ajustes/setting-row";
import type { FudoConnectionView, FudoResourcePreflight } from "@/lib/integrations/fudo/service";
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
  const [preflight, setPreflight] = useState<FudoResourcePreflight | null>(null);
  const connected = status.status === "connected";
  const hasCredentials = status.status !== "disconnected";

  const execute = (action: () => Promise<{ ok: boolean; message: string }>, clear = false) => {
    setNotice(null);
    setPreflight(null);
    startTransition(async () => {
      const result = await action();
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok && clear) { setKey(""); setSecret(""); }
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
            Necesitás el Plan Pro y la API Pública General habilitada desde Fudo. Generá una cuenta API
            con permisos de lectura. Las claves se transmiten al servidor y se guardan cifradas;
            nunca se muestran nuevamente ni se incluyen en los registros de sincronización.
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
            {hasCredentials && <Button disabled={working} onClick={() => execute(async () => {
              const result = await inspectFudoPermissionsAction();
              setPreflight(result);
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
        {preflight && preflight.checks.length > 0 && (
          <div className="mt-3 rounded-xl border border-line p-4" aria-live="polite">
            <p className="mb-3 text-xs font-semibold text-ink">Lectura por recurso (sin importar datos)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {preflight.checks.map(({ resource, code }) => (
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
          <p className="text-xs font-semibold text-ink">Total importado por recurso</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Registros únicos guardados en staging de esta conexión. No son totales de Fudo
            hasta que se complete la paginación y se concilien ambas fuentes.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(LABELS).map(([code, label]) => (
              <p key={code} className="flex justify-between gap-2 text-xs text-ink">
                <span>{label}</span>
                <span className="font-semibold tabular-nums">{(status.importedCounts[code] ?? 0).toLocaleString("es-AR")}</span>
              </p>
            ))}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-line p-4">
          <p className="text-xs font-semibold text-ink">Paginación de la importación actual</p>
          <p className="mt-1 text-xs text-ink-muted">
            Cada recurso conserva su avance. Una página completada no equivale a datos conciliados contra Fudo.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(LABELS).map(([resource, label]) => {
              const nextPage = status.nextPages[resource];
              return (
                <p key={resource} className="flex justify-between gap-2 text-xs text-ink">
                  <span>{label}</span>
                  <span className={nextPage === 0 ? "text-success-400" : "text-ink-muted"}>
                    {nextPage === 0 ? "Ciclo leído" : typeof nextPage === "number" ? `Pendiente: página ${nextPage}` : "Sin iniciar"}
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
            onClick={() => execute(syncFudoAction)}>
            <DatabaseZap className="h-4 w-4" /> {working ? "Sincronizando…" : "Sincronizar datos"}
          </Button>
          {status.lastSyncStatus === "partial" && <span className="text-xs text-ink-muted">
            Volvé a sincronizar para continuar con la siguiente tanda.
          </span>}
        </div>
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
