import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { BusinessBasicsForm } from "./business-basics-form";

export default async function BusinessSettingsLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return <Unavailable message="Supabase no está configurado. No mostramos datos demo del negocio." />;

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return <Unavailable message="No se pudo resolver el negocio activo." />;

  const [businessRes, branchesRes] = await Promise.all([
    supabase.from("businesses").select("name,tax_id,timezone,sales_channels").eq("id", ctx.businessId).maybeSingle(),
    supabase.from("branches").select("id,name,address,is_main,branch_type").eq("business_id", ctx.businessId).order("is_main", { ascending: false }).order("name"),
  ]);

  if (businessRes.error || branchesRes.error) {
    const code = businessRes.error?.code ?? branchesRes.error?.code ?? "query_error";
    return <Unavailable message={`No pudimos leer la configuración real del negocio (${code}).`} />;
  }

  const business = businessRes.data as { name: string | null; tax_id: string | null; timezone: string | null; sales_channels: string[] | null } | null;
  const branches = (branchesRes.data ?? []) as Array<{ id: string; name: string; address: string | null; is_main: boolean | null; branch_type: string | null }>;
  const channels = business?.sales_channels ?? [];

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Ajustes · Negocio" title="Configuración del negocio" description="Datos persistidos en Supabase. En producción no mostramos sucursales, canales ni datos fiscales ficticios." />

      <Card>
        <CardHeader><CardTitle>Datos del negocio</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <BusinessBasicsForm initialName={business?.name ?? ""} initialTaxId={business?.tax_id ?? ""} />
          <div className="grid gap-3 border-t border-line pt-4 text-sm md:grid-cols-2">
            <div><div className="text-xs text-ink-muted">Zona horaria</div><div className="mt-1 text-ink">{business?.timezone || "No configurada"}</div></div>
            <div><div className="text-xs text-ink-muted">Canales persistidos</div><div className="mt-1 text-ink">{channels.length ? channels.join(", ") : "Sin canales configurados"}</div></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sucursales y puntos de venta</CardTitle><Badge tone="default">{branches.length}</Badge></CardHeader>
        <CardContent>
          {branches.length ? (
            <ul className="space-y-2">
              {branches.map((branch) => (
                <li key={branch.id} className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-elevated"><Building2 className="h-4 w-4 text-brand-400" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink">{branch.name}</span>{branch.is_main && <Badge tone="brand">Principal</Badge>}{branch.branch_type && <Badge tone="default">{branch.branch_type}</Badge>}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted"><MapPin className="h-3 w-3" />{branch.address || "Sin dirección cargada"}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">No hay sucursales persistidas para este negocio.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Medios de pago</CardTitle></CardHeader>
        <CardContent><div className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">La base actual no tiene un modelo persistido de medios de pago por negocio. No mostramos los medios ficticios de la demo como si estuvieran configurados.</div></CardContent>
      </Card>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Ajustes · Negocio" title="Configuración temporalmente no disponible" description="No podemos confirmar los datos reales del negocio en este momento." />
      <Card><CardContent className="pt-6"><div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">{message}</div></CardContent></Card>
    </div>
  );
}
