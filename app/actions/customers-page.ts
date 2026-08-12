"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type CustomerPageRow = {
  id: string;
  nombre: string;
  canal: string;
  visitas: number;
  ultima: string;
  ticket: number;
  estado: "frecuente" | "inactivo" | "activo";
};

export type CustomersPageData = {
  customers: CustomerPageRow[];
  activeCount: number;
  frequentCount: number;
  inactiveCount: number;
  averageTicket: number;
};

export async function getCustomersPageDataAction(): Promise<
  { ok: true; data: CustomersPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const res = await supabase
    .from("customers")
    .select("id,name,channel,visits,total_spend,last_visit_at,segment")
    .eq("business_id", ctx.businessId)
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .limit(2000);

  if (res.error) {
    return { ok: false, error: `No se pudieron leer los clientes (${res.error.code ?? "query_error"}).` };
  }

  const now = Date.now();
  const rows = (res.data ?? []) as Array<{
    id: string;
    name: string;
    channel: string | null;
    visits: number | null;
    total_spend: number | string | null;
    last_visit_at: string | null;
    segment: string | null;
  }>;

  const customers: CustomerPageRow[] = rows.map((row) => {
    const visits = Number(row.visits ?? 0);
    const totalSpend = Number(row.total_spend ?? 0);
    const daysSinceVisit = row.last_visit_at
      ? Math.floor((now - new Date(row.last_visit_at).getTime()) / 86_400_000)
      : null;
    const inactive = daysSinceVisit == null || daysSinceVisit > 30;
    const frequent = !inactive && (row.segment?.toLowerCase() === "frecuente" || visits >= 3);
    return {
      id: row.id,
      nombre: row.name,
      canal: row.channel ?? "Sin canal",
      visitas: visits,
      ultima: row.last_visit_at
        ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(row.last_visit_at))
        : "Sin visitas",
      ticket: visits > 0 ? totalSpend / visits : 0,
      estado: inactive ? "inactivo" : frequent ? "frecuente" : "activo",
    };
  });

  const activeCount = customers.filter((row) => row.estado !== "inactivo").length;
  const frequentCount = customers.filter((row) => row.estado === "frecuente").length;
  const inactiveCount = customers.filter((row) => row.estado === "inactivo").length;
  const totalVisits = rows.reduce((sum, row) => sum + Number(row.visits ?? 0), 0);
  const totalSpend = rows.reduce((sum, row) => sum + Number(row.total_spend ?? 0), 0);
  const averageTicket = totalVisits > 0 ? totalSpend / totalVisits : 0;

  return { ok: true, data: { customers, activeCount, frequentCount, inactiveCount, averageTicket } };
}
