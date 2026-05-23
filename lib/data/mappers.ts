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

// ---------- INBOX (whatsapp_messages + ai_extractions) ----------
type MessageRow = Tables["whatsapp_messages"]["Row"];
type ExtractionRow = Tables["ai_extractions"]["Row"];

const TYPE_LABELS: Record<string, string> = {
  purchase: "Compra de insumo",
  sale: "Cierre de ventas diario",
  expense: "Gasto fijo",
  stock_update: "Actualización de stock",
  employee_advance: "Adelanto a empleado",
  daily_closure: "Cierre operativo",
  supplier_price_change: "Alerta de precio",
  unknown: "Movimiento sin clasificar",
};

const STATUS_TO_INBOX: Record<string, "pendiente" | "aprobado" | "revision"> = {
  pending: "pendiente",
  needs_review: "revision",
  approved: "aprobado",
  rejected: "revision",
  failed: "revision",
};

export function mapInboxItem(msg: MessageRow, extraction: ExtractionRow | null) {
  const fields = (extraction?.fields as Record<string, any>) ?? {};

  const extracted = {
    tipo: TYPE_LABELS[extraction?.type ?? "unknown"] ?? "Movimiento",
    monto: fields.total_amount ?? fields.amount,
    proveedor: fields.supplier,
    empleado: fields.employee_name,
    insumo: fields.item ?? fields.ingredient,
    cantidad:
      fields.quantity != null && fields.unit
        ? `${fields.quantity} ${fields.unit}`
        : fields.qty != null && fields.unit
          ? `${fields.qty} ${fields.unit}`
          : undefined,
    medioPago: fields.payment_method,
    canal:
      Array.isArray(fields.channels) && fields.channels.length
        ? fields.channels.map((c: any) => c.channel).join(" / ")
        : undefined,
    categoria: fields.category ?? "Sin clasificar",
    fecha: fields.date ?? "Hoy",
    confidence: extraction?.confidence ?? 0,
    missing: extraction?.missing as string[] | undefined,
  };

  const channel: "texto" | "audio" | "foto" =
    msg.channel === "audio" ? "audio" : msg.channel === "image" || msg.channel === "document" ? "foto" : "texto";

  return {
    id: msg.id,
    sender: msg.sender_name,
    role: msg.sender_role,
    channel,
    receivedAt: new Date(msg.received_at),
    status: STATUS_TO_INBOX[extraction?.status ?? "pending"] ?? "pendiente",
    preview: msg.preview || msg.raw.slice(0, 120),
    raw: msg.raw,
    extracted,
    // Extras útiles para acciones server-side. La UI tipada actual los
    // ignora porque su tipo es estricto, pero los usamos en el cast del
    // wrapper.
    extractionId: extraction?.id ?? null,
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
