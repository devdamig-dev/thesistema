import Link from "next/link";
import { ArrowLeft, LifeBuoy, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentUserContext } from "@/lib/data/auth";
import { getRoleLabel } from "@/lib/permissions";

const MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  inbox_ai: "Inbox IA",
  reports_ai: "Reportes IA",
  marketing_ai: "Marketing IA",
  invoices_ocr: "Facturas OCR",
  daily_closures: "Cierres diarios",
  sales: "Ventas",
  purchases: "Compras",
  fixed_expenses: "Gastos fijos",
  debts: "Deudas",
  stock: "Stock",
  products: "Productos",
  balances: "Balances",
  employees: "Empleados",
  customers: "Clientes",
};

export default async function SinPermisosPage({
  searchParams,
}: {
  searchParams: { m?: string; from?: string };
}) {
  const ctx = await getCurrentUserContext();
  const moduleKey = searchParams.m ?? "";
  const fromPath = searchParams.from ?? "/";
  const moduleLabel = MODULE_LABEL[moduleKey] ?? moduleKey ?? "esa sección";

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
      <div className="card relative w-full overflow-hidden p-8 text-center">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-danger-500/15 blur-3xl" />

        <div className="relative">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-danger-500/30 bg-danger-500/10">
            <ShieldOff className="h-7 w-7 text-danger-400" />
          </div>

          <Badge tone="danger" className="mt-4">
            Acceso denegado
          </Badge>

          <h1 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-ink">
            No podés acceder a {moduleLabel}
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            Tu rol actual ({getRoleLabel(ctx.role)}) no incluye permiso para
            ver este módulo.
          </p>

          {moduleKey && (
            <div className="mt-4 rounded-lg border border-line bg-bg-subtle/60 p-3 text-left text-xs">
              <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                Detalle técnico
              </div>
              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink-muted">
                <span>Módulo:</span>
                <code className="text-ink">{moduleKey}</code>
                <span>Tu rol:</span>
                <code className="text-ink">{ctx.role}</code>
                {fromPath !== "/" && (
                  <>
                    <span>Ruta:</span>
                    <code className="text-ink">{fromPath}</code>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Link href="/">
              <Button variant="primary" size="lg" className="w-full">
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio
              </Button>
            </Link>
            <Link href="/ayuda">
              <Button variant="ghost" size="md" className="w-full">
                <LifeBuoy className="h-4 w-4" />
                Pedir ayuda al equipo
              </Button>
            </Link>
          </div>

          <p className="mt-4 text-[11px] text-ink-subtle">
            Si pensás que esto es un error, contactá al socio o administrador
            del negocio.
          </p>
        </div>
      </div>
    </div>
  );
}
