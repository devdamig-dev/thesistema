/**
 * Mappers — convierten filas crudas de Supabase (snake_case) a las
 * estructuras que la UI ya consume desde `lib/mock-data.ts`.
 *
 * Cada repositorio supabase usa estos helpers para que el switch
 * entre demo y database no requiera tocar páginas ni componentes.
 */

import type { Database } from "@/lib/supabase/types";

type Tables = Database["public"]["Tables"];

// ---------- BUSINESS ----------
export function mapBusiness(
  org: Pick<Tables["organizations"]["Row"], "name" | "plan">,
  biz: Pick<Tables["businesses"]["Row"], "name">,
  branch: Pick<Tables["branches"]["Row"], "address"> | null,
  ownerName: string,
) {
  return {
    name: biz.name,
    plan: capitalize(org.plan),
    owner: ownerName,
    location: branch?.address ?? "—",
  };
}

// ---------- PRODUCTS ----------
type ProductRow = Tables["products"]["Row"];

export function mapProduct(p: ProductRow) {
  const margin = p.price > 0 ? ((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100 : 0;
  const estado: "ok" | "margen-bajo" = margin < 50 ? "margen-bajo" : "ok";
  return {
    nombre: p.name,
    categoria: p.category,
    precio: Number(p.price),
    costo: Number(p.cost),
    ingredientes: [] as string[], // se completa con recipe_items si hace falta
    estado,
  };
}

// ---------- EMPLOYEES ----------
type EmployeeRow = Tables["employees"]["Row"];

export function mapEmployee(e: EmployeeRow) {
  return {
    nombre: e.full_name,
    rol: e.role,
    turno: e.shift ?? "—",
    horasMes: Number(e.monthly_hours),
    costoMes: Number(e.monthly_cost),
    adelantos: Number(e.pending_advance),
    faltas: e.absences,
    tardes: e.late_arrivals,
  };
}

// ---------- CUSTOMERS ----------
type CustomerRow = Tables["customers"]["Row"];

export function mapCustomer(c: CustomerRow) {
  return {
    nombre: c.name,
    canal: c.channel ?? "—",
    visitas: c.visits,
    ultima: relativeLabel(c.last_visit_at),
    ticket: c.visits > 0 ? Math.round(Number(c.total_spend) / c.visits) : 0,
    estado: c.segment ?? "frecuente",
  };
}

// ---------- SUPPLIERS ----------
type SupplierRow = Tables["suppliers"]["Row"];

export function mapSupplier(s: SupplierRow) {
  return {
    nombre: s.name,
    rubro: s.category ?? "—",
    totalMes: 0, // se calcula con agregados en sprint próximo
    ordenes: 0,
    tendencia: 0,
  };
}

// ---------- EXPENSES ----------
type ExpenseRow = Tables["expenses"]["Row"];

export function mapExpense(e: ExpenseRow) {
  const estadoMap: Record<string, string> = {
    paid: "pagado",
    scheduled: "programado",
    pending: "pendiente",
    variable: "variable",
    auto: "automático",
  };
  return {
    nombre: e.name,
    monto: Number(e.amount),
    vencimiento: e.due_date
      ? new Date(e.due_date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
      : "—",
    estado: estadoMap[e.status] ?? e.status,
  };
}

// ---------- AI RECOMMENDATIONS ----------
type RecRow = Tables["ai_recommendations"]["Row"];

export function mapRecommendation(r: RecRow) {
  const prioridad: "alta" | "media" | "baja" =
    r.priority === "high" ? "alta" : r.priority === "low" ? "baja" : "media";
  return {
    id: r.id,
    prioridad,
    titulo: r.title,
    motivo: r.detail,
    impacto: `+$${Number(r.estimated_impact).toLocaleString("es-AR")}`,
    confianza: Number(r.confidence),
    area: capitalize(r.area),
  };
}

// ---------- helpers ----------
function capitalize(s: string) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function relativeLabel(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 86400) return "Hoy";
  const days = Math.floor(diff / 86400);
  if (days === 1) return "Ayer";
  if (days < 14) return `Hace ${days} días`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
