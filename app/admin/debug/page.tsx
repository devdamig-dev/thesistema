import { notFound, redirect } from "next/navigation";
import {
  AlertOctagon,
  CheckCircle2,
  Database,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { checkInternalAdmin } from "@/lib/admin/auth";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type CheckResult =
  | { ok: true; count: number }
  | { ok: false; error: string; code?: string };

/**
 * Muestra sólo el host de la URL de Supabase (nunca la key entera).
 * "https://xxxx.supabase.co" → "xxxx.supabase.co"
 */
function maskSupabaseUrl(url: string): string {
  if (!url) return "(no seteada)";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

async function countTable(table: string): Promise<CheckResult> {
  try {
    const db = createSupabaseAdminClient() as any;
    const res = await db.from(table).select("id", { count: "exact", head: true });
    if (res.error) {
      return {
        ok: false,
        error: res.error.message ?? "unknown_error",
        code: res.error.code,
      };
    }
    return { ok: true, count: (res.count as number) ?? 0 };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message ?? String(error),
      code: error?.code,
    };
  }
}

export default async function DebugPage() {
  const check = await checkInternalAdmin();
  if (!check.allowed) {
    if (check.reason === "disabled") notFound();
    if (check.reason === "not-authenticated") redirect("/login?next=/admin/debug");
    redirect("/sin-permisos?m=internal_admin&from=/admin/debug");
  }

  const demo = isDemoMode();
  const url = env.supabaseUrl;
  const hasAnon = !!env.supabaseAnonKey;
  const hasService = !!env.supabaseServiceRoleKey;

  // Ping de conexión: si estamos en database mode, hacemos un count(*)
  // liviano contra `organizations`. Si tira, capturamos el error exacto.
  let orgsRes: CheckResult;
  let bizRes: CheckResult;
  let profilesRes: CheckResult;
  if (demo) {
    orgsRes = { ok: false, error: "demo_mode_no_query" };
    bizRes = { ok: false, error: "demo_mode_no_query" };
    profilesRes = { ok: false, error: "demo_mode_no_query" };
  } else {
    [orgsRes, bizRes, profilesRes] = await Promise.all([
      countTable("organizations"),
      countTable("businesses"),
      countTable("profiles"),
    ]);
  }

  const canConnect = !demo && (orgsRes.ok || bizRes.ok || profilesRes.ok);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Interno · Debug"
        title="Estado de conexión a Supabase"
        description="Página temporal para verificar que la app está usando la base real y no los datos mock. Muestra el modo de la app, la URL de Supabase (sin secretos) y el count de organizaciones, businesses y profiles."
        actions={
          <Badge tone={demo ? "warn" : "ai"}>
            <ShieldAlert className="h-3 w-3" />
            {demo ? "DEMO MODE" : "DATABASE MODE"}
          </Badge>
        }
      />

      {/* Modo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Modo de la app
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            label="isDemoMode()"
            value={String(demo)}
            tone={demo ? "warn" : "success"}
          />
          <Row
            label="env.appMode"
            value={env.appMode}
            tone={demo ? "warn" : "success"}
          />
          <Row
            label="NEXT_PUBLIC_APP_MODE (raw)"
            value={process.env.NEXT_PUBLIC_APP_MODE ?? "(no seteada)"}
          />
        </CardContent>
      </Card>

      {/* Supabase */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración de Supabase</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="URL" value={maskSupabaseUrl(url)} tone={url ? "default" : "danger"} />
          <Row
            label="NEXT_PUBLIC_SUPABASE_ANON_KEY presente"
            value={hasAnon ? "sí" : "no"}
            tone={hasAnon ? "success" : "danger"}
          />
          <Row
            label="SUPABASE_SERVICE_ROLE_KEY presente"
            value={hasService ? "sí" : "no"}
            tone={hasService ? "success" : "danger"}
          />
          <p className="text-[10px] text-ink-subtle">
            Sólo se muestra el host de la URL — nunca las keys completas.
          </p>
        </CardContent>
      </Card>

      {/* Conexión */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {canConnect ? (
              <CheckCircle2 className="h-4 w-4 text-success-400" />
            ) : (
              <XCircle className="h-4 w-4 text-danger-400" />
            )}
            Conexión al cliente
          </CardTitle>
          <Badge tone={canConnect ? "success" : demo ? "warn" : "danger"}>
            {canConnect
              ? "OK — la app se conectó y pudo leer al menos una tabla"
              : demo
                ? "No aplica en demo mode"
                : "No pudo conectar / leer"}
          </Badge>
        </CardHeader>
      </Card>

      {/* Counts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CountCard label="organizations" result={orgsRes} demo={demo} />
        <CountCard label="businesses" result={bizRes} demo={demo} />
        <CountCard label="profiles" result={profilesRes} demo={demo} />
      </div>

      {/* Errores si los hay */}
      {[orgsRes, bizRes, profilesRes].some((r) => !r.ok && !demo) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-danger-400" />
              Errores detectados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {(
              [
                ["organizations", orgsRes],
                ["businesses", bizRes],
                ["profiles", profilesRes],
              ] as const
            )
              .filter(([, r]) => !r.ok)
              .map(([name, r]) => (
                <pre
                  key={name}
                  className="whitespace-pre-wrap rounded-lg border border-danger-500/25 bg-danger-500/[0.05] p-3 font-mono text-[11px] text-danger-400"
                >
                  {name}:{" "}
                  {JSON.stringify(
                    { error: (r as any).error, code: (r as any).code },
                    null,
                    2,
                  )}
                </pre>
              ))}
          </CardContent>
        </Card>
      )}

      <div className="rounded-xl border border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted">
        Página <code className="text-ink">/admin/debug</code> — temporal, para
        verificar que el piloto no está sirviendo mock data. Se puede quitar
        cuando ya no haga falta borrando <code>app/admin/debug/</code>.
      </div>
    </div>
  );
}

/* ------------------------- subcomponents ------------------------- */

function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warn" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-success-400"
      : tone === "warn"
        ? "text-warn-400"
        : tone === "danger"
          ? "text-danger-400"
          : "text-ink";
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-bg-subtle/40 px-3 py-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className={cn("font-mono text-xs", color)}>{value}</span>
    </div>
  );
}

function CountCard({
  label,
  result,
  demo,
}: {
  label: string;
  result: CheckResult;
  demo: boolean;
}) {
  const tone = demo
    ? "warn"
    : result.ok
      ? "success"
      : "danger";
  const value = demo
    ? "—"
    : result.ok
      ? String(result.count)
      : "error";
  const ring =
    tone === "danger"
      ? "border-danger-500/30"
      : tone === "warn"
        ? "border-warn-500/30"
        : "border-success-500/30";
  const color =
    tone === "danger"
      ? "text-danger-400"
      : tone === "warn"
        ? "text-warn-400"
        : "text-success-400";
  return (
    <div className={cn("rounded-xl border bg-bg-subtle/40 p-4", ring)}>
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
        Tabla · {label}
      </div>
      <div className={cn("mt-2 text-3xl font-semibold tabular-nums", color)}>{value}</div>
      <div className="mt-1 text-[10px] text-ink-subtle">
        {demo
          ? "no se consulta en demo mode"
          : result.ok
            ? "count(*) exitoso"
            : (result as any).error}
      </div>
    </div>
  );
}
