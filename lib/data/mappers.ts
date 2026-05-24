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

// ---------- SALES ----------
type SaleRow = Tables["sales"]["Row"];

const CHANNEL_LABEL: Record<string, string> = {
  salon: "Salón",
  delivery: "Delivery propio",
  whatsapp: "WhatsApp",
  pedidos_ya: "PedidosYa",
  rappi: "Rappi",
  mp_qr: "Mercado Pago QR",
};

export function aggregateSalesByChannel(rows: SaleRow[]): {
  canal: string;
  total: number;
  share: number;
  ticket: number;
  delta: number;
}[] {
  if (rows.length === 0) return [];
  const map = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const channel = (r.channel ?? "salon") as string;
    const entry = map.get(channel) ?? { total: 0, count: 0 };
    entry.total += Number(r.amount);
    entry.count += 1;
    map.set(channel, entry);
  }
  const grandTotal = [...map.values()].reduce((s, e) => s + e.total, 0);
  return [...map.entries()]
    .map(([channel, e]) => ({
      canal: CHANNEL_LABEL[channel] ?? channel,
      total: e.total,
      share: grandTotal > 0 ? (e.total / grandTotal) * 100 : 0,
      ticket: e.count > 0 ? Math.round(e.total / e.count) : 0,
      delta: 0, // sin baseline histórico → 0; en sprint próximo sumamos comparativa
    }))
    .sort((a, b) => b.total - a.total);
}

export function aggregateSalesByDay(rows: SaleRow[]): {
  day: string;
  ventas: number;
  costo: number;
}[] {
  if (rows.length === 0) return [];
  const map = new Map<string, number>();
  for (const r of rows) {
    const day = new Date(r.occurred_at).toISOString().slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + Number(r.amount));
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, ventas]) => ({
      day: new Date(day).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }),
      ventas,
      // Estimación de costo 65% — luego lo recalculamos con cost real.
      costo: Math.round(ventas * 0.65),
    }));
}

export function aggregateDailySalesTable(rows: SaleRow[]): {
  fecha: string;
  salon: number;
  delivery: number;
  pya: number;
  wa: number;
  total: number;
}[] {
  if (rows.length === 0) return [];
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const day = new Date(r.occurred_at).toISOString().slice(0, 10);
    const channel = (r.channel ?? "salon") as string;
    const entry = map.get(day) ?? { salon: 0, delivery: 0, pya: 0, wa: 0, total: 0 };
    const amount = Number(r.amount);
    if (channel === "salon") entry.salon += amount;
    else if (channel === "delivery") entry.delivery += amount;
    else if (channel === "pedidos_ya") entry.pya += amount;
    else if (channel === "whatsapp") entry.wa += amount;
    entry.total += amount;
    map.set(day, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, e]) => ({
      fecha: new Date(day).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
      salon: e.salon,
      delivery: e.delivery,
      pya: e.pya,
      wa: e.wa,
      total: e.total,
    }));
}

// ---------- STOCK ----------
type StockItemRow = Tables["stock_items"]["Row"];

export function mapStockItem(
  row: StockItemRow,
  ingredientName: string,
  ingredientUnit: string,
) {
  const current = Number(row.current);
  const min = Number(row.min);
  const ratio = min > 0 ? current / min : 1;
  // Estado: critico (<0.5), alerta (<1), ok
  const estado: "critico" | "alerta" | "ok" =
    ratio < 0.5 ? "critico" : ratio < 1 ? "alerta" : "ok";
  // Días estimados de cobertura — proxy simple sin consumo histórico.
  // Usamos current/min como aproximación (1 día por unidad mínima).
  const dias = Math.max(1, Math.round(current));
  return {
    insumo: ingredientName,
    unidad: ingredientUnit,
    stock: current,
    minimo: min,
    dias,
    estado,
  };
}

// ---------- DAILY CLOSURES ----------
type ClosureRow = Tables["daily_closures"]["Row"];

export function mapDailyClosure(row: ClosureRow) {
  const parsed = (row.parsed as any) ?? {};
  return {
    id: row.id,
    punto: parsed.business_unit ?? "Local principal",
    fecha: new Date(row.closure_date).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    recibida: new Date(row.created_at),
    sender: parsed.sender ?? "Equipo",
    status: row.status === "approved" ? "aprobado" : "pendiente",
    raw: row.raw_text ?? "",
    parsed: {
      ingresos: parsed.incomes ?? [],
      gastos: parsed.expenses ?? [],
      retiros: parsed.withdrawals ?? [],
      cambio: Number(parsed.change ?? 0),
      productos: parsed.products ?? [],
      total: Number(row.gross_total ?? 0),
      neto: Number(row.net_total ?? 0),
    },
    inconsistencias: (row.inconsistencies as any) ?? [],
  };
}

// ---------- INVOICES ----------
type InvoiceRow = Tables["invoices"]["Row"];

const INVOICE_STATUS_TO_UI: Record<string, string> = {
  processing: "procesando",
  uploaded: "procesando",
  extracted: "revision",
  needs_review: "revision",
  approved: "aprobado",
  sent_to_accountant: "contador",
  rejected: "revision",
  failed: "revision",
};

export function mapInvoice(row: InvoiceRow, supplierName?: string | null) {
  return {
    id: row.id,
    proveedor: supplierName ?? row.sender ?? "Sin proveedor",
    cuit: row.tax_id ?? "—",
    numero: row.number,
    tipo: row.type as "A" | "B" | "C",
    fecha: new Date(row.invoice_date).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    recibida: new Date(row.created_at),
    source: (row.source ?? "foto") as "foto" | "pdf",
    status: INVOICE_STATUS_TO_UI[row.status] ?? "revision",
    confidence: Number(row.confidence ?? 0),
    metodoPago: row.payment_method,
    subtotal: Number(row.subtotal),
    iva: Number(row.tax),
    total: Number(row.total),
    sender: row.sender ?? "—",
    vencimiento: row.due_date
      ? new Date(row.due_date).toLocaleDateString("es-AR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : undefined,
    items: [] as any[],
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
  debt_created: "Nueva deuda",
  debt_payment: "Pago de deuda",
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

// ---------- DEUDAS ----------
type DebtRow = Tables["debts"]["Row"];
type DebtPaymentRow = Tables["debt_payments"]["Row"];

const DEBT_STATUS_TO_UI = {
  active: "activa",
  overdue: "vencida",
  settled: "saldada",
} as const;

export function mapDebt(d: DebtRow, payments: DebtPaymentRow[] = []) {
  return {
    id: d.id,
    acreedor: d.creditor,
    concepto: d.concept ?? "",
    montoInicial: Number(d.original_amount),
    saldoPendiente: Number(d.pending_amount),
    interesMensual: d.interest_rate != null ? Number(d.interest_rate) : undefined,
    vencimiento: d.due_date
      ? new Date(d.due_date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : undefined,
    estado: DEBT_STATUS_TO_UI[d.status] ?? "activa",
    tomada: new Date(d.taken_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    saldadaEl: d.settled_at
      ? new Date(d.settled_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : undefined,
    pagos: payments.map((p) => ({
      id: p.id,
      fecha: new Date(p.paid_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
      monto: Number(p.amount),
      metodo: p.payment_method,
      notas: p.notes ?? undefined,
    })),
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
