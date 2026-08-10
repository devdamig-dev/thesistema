"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";
import { buildCsv, csvFilename } from "@/lib/csv";
import {
  invoices as mockInvoices,
  dailySalesTable,
  employees as mockEmployees,
  debts as mockDebts,
  DEBT_CATEGORY_LABELS,
  type DebtCategory,
} from "@/lib/mock-data";

export type ExportResult =
  | { ok: true; persisted: boolean; filename: string; content: string; rows: number }
  | { ok: false; persisted: boolean; error: string };

async function getDatabaseContext() {
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId) return null;
  return { ctx, db: createSupabaseAdminClient() as any, businessId: ctx.businessId };
}

function dbError(error: unknown): ExportResult {
  console.error("[exports] database export failed", error);
  return { ok: false, persisted: false, error: "No se pudo generar el archivo con los datos reales del negocio." };
}

async function auditExport(businessId: string, action: string, targetType: string, summary: string) {
  await logActivity({ businessId, action, targetType, summary }).catch(() => {});
}

export async function exportPurchasesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("purchases.view");
  if (guard) return guard;

  const headers = [
    { key: "fecha", label: "Fecha" }, { key: "proveedor", label: "Proveedor" },
    { key: "cuit", label: "CUIT" }, { key: "tipo", label: "Tipo" },
    { key: "punto_venta", label: "Punto de venta" }, { key: "numero", label: "Número" },
    { key: "subtotal", label: "Subtotal" }, { key: "iva", label: "IVA" },
    { key: "otros_impuestos", label: "Otros impuestos" }, { key: "total", label: "Total" },
    { key: "medio_pago", label: "Medio de pago" }, { key: "categoria", label: "Categoría" },
    { key: "estado_ia", label: "Estado IA" }, { key: "estado_aprobacion", label: "Estado aprobación" },
    { key: "adjunto", label: "Adjunto" }, { key: "observaciones", label: "Observaciones" },
  ] as const;

  if (isDatabaseMode()) {
    try {
      const resolved = await getDatabaseContext();
      if (!resolved) return { ok: false, persisted: false, error: "No hay un negocio autenticado para exportar." };
      const { db, businessId } = resolved;
      const res = await db.from("invoices")
        .select("invoice_date, number, type, tax_id, subtotal, tax, total, payment_method, status, confidence, ai_provider, storage_path, suppliers(name, tax_id)")
        .eq("business_id", businessId)
        .order("invoice_date", { ascending: false })
        .limit(1000);
      if (res.error) return dbError(res.error);
      const rows = ((res.data as any[]) ?? []).map((r) => {
        const parts = String(r.number ?? "").split("-");
        const supplier = Array.isArray(r.suppliers) ? r.suppliers[0] : r.suppliers;
        return {
          fecha: r.invoice_date ?? "", proveedor: supplier?.name ?? "—", cuit: supplier?.tax_id ?? r.tax_id ?? "",
          tipo: r.type ?? "", punto_venta: parts.length > 1 ? parts.at(-2) ?? "" : "", numero: parts.at(-1) ?? "",
          subtotal: Number(r.subtotal ?? 0), iva: Number(r.tax ?? 0), otros_impuestos: 0, total: Number(r.total ?? 0),
          medio_pago: r.payment_method ?? "", categoria: "Compra", estado_ia: r.ai_provider ?? "—",
          estado_aprobacion: r.status ?? "", adjunto: r.storage_path ? "Sí" : "No",
          observaciones: r.confidence != null ? `IA ${Math.round(Number(r.confidence) * 100)}%` : "",
        };
      });
      const csv = buildCsv(headers as any, rows as any);
      await auditExport(businessId, "purchases.exported", "invoices", `Exporte CSV compras · ${rows.length} filas`);
      return { ok: true, persisted: true, filename: csvFilename("compras"), content: csv, rows: rows.length };
    } catch (error) { return dbError(error); }
  }

  const rows = mockInvoices.map((inv) => {
    const parts = inv.numero.split("-");
    return {
      fecha: inv.fecha, proveedor: inv.proveedor, cuit: inv.cuit, tipo: inv.tipo,
      punto_venta: parts.length > 1 ? parts.at(-2) ?? "" : "", numero: parts.at(-1) ?? "",
      subtotal: inv.subtotal, iva: inv.iva, otros_impuestos: 0, total: inv.total,
      medio_pago: inv.metodoPago, categoria: "Compra", estado_ia: `${Math.round(inv.confidence * 100)}% confianza`,
      estado_aprobacion: inv.status, adjunto: inv.source === "pdf" ? "PDF" : "Imagen",
      observaciones: inv.items.map((i) => i.desc).join(" · "),
    };
  });
  return { ok: true, persisted: false, filename: csvFilename("compras"), content: buildCsv(headers as any, rows as any), rows: rows.length };
}

export async function exportSalesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("sales.view");
  if (guard) return guard;

  const headers = [
    { key: "fecha", label: "Fecha" }, { key: "sucursal", label: "Sucursal" },
    { key: "canal", label: "Canal" }, { key: "medio_pago", label: "Medio de pago" },
    { key: "importe_bruto", label: "Importe bruto" }, { key: "descuentos", label: "Descuentos" },
    { key: "comisiones", label: "Comisiones" }, { key: "importe_neto", label: "Importe neto" },
    { key: "iva_estimado", label: "IVA estimado (21%)" }, { key: "origen", label: "Origen del dato" },
    { key: "observaciones", label: "Observaciones" },
  ] as const;
  const commission: Record<string, number> = { pedidos_ya: 0.22 };
  const channelLabel: Record<string, string> = {
    salon: "Salón", delivery: "Delivery propio", pedidos_ya: "PedidosYa", whatsapp: "WhatsApp", rappi: "Rappi", mp_qr: "Mercado Pago QR",
  };

  if (isDatabaseMode()) {
    try {
      const resolved = await getDatabaseContext();
      if (!resolved) return { ok: false, persisted: false, error: "No hay un negocio autenticado para exportar." };
      const { db, businessId } = resolved;
      const res = await db.from("sales")
        .select("occurred_at, channel, amount, branches(name)")
        .eq("business_id", businessId)
        .order("occurred_at", { ascending: false })
        .limit(5000);
      if (res.error) return dbError(res.error);
      const rows = ((res.data as any[]) ?? []).map((r) => {
        const bruto = Number(r.amount ?? 0);
        const com = Math.round(bruto * (commission[r.channel] ?? 0));
        const neto = bruto - com;
        const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
        return {
          fecha: r.occurred_at ? String(r.occurred_at).slice(0, 10) : "", sucursal: branch?.name ?? "—",
          canal: channelLabel[r.channel] ?? r.channel ?? "", medio_pago: "", importe_bruto: bruto, descuentos: 0,
          comisiones: com, importe_neto: neto, iva_estimado: Math.round((neto / 1.21) * 0.21),
          origen: "Registro de ventas", observaciones: com > 0 ? "Comisión estimada según canal" : "",
        };
      });
      const csv = buildCsv(headers as any, rows as any);
      await auditExport(businessId, "sales.exported", "sales", `Exporte CSV ventas · ${rows.length} filas`);
      return { ok: true, persisted: true, filename: csvFilename("ventas"), content: csv, rows: rows.length };
    } catch (error) { return dbError(error); }
  }

  const demoCommission = { "Salón": 0, "Delivery propio": 0, "PedidosYa": 0.22, "WhatsApp": 0 } as const;
  const rows: any[] = [];
  for (const d of dailySalesTable) {
    const entries: { canal: keyof typeof demoCommission; bruto: number }[] = [
      { canal: "Salón", bruto: d.salon }, { canal: "Delivery propio", bruto: d.delivery },
      { canal: "PedidosYa", bruto: d.pya }, { canal: "WhatsApp", bruto: d.wa },
    ];
    for (const e of entries) {
      if (e.bruto <= 0) continue;
      const com = Math.round(e.bruto * demoCommission[e.canal]); const neto = e.bruto - com;
      rows.push({ fecha: d.fecha, sucursal: "Casa Central", canal: e.canal, medio_pago: e.canal === "WhatsApp" ? "Transferencia" : e.canal === "PedidosYa" ? "App" : "Mixto", importe_bruto: e.bruto, descuentos: 0, comisiones: com, importe_neto: neto, iva_estimado: Math.round((neto / 1.21) * 0.21), origen: e.canal === "Salón" ? "Cierre de caja" : "Conciliación canal", observaciones: e.canal === "PedidosYa" ? "Comisión 22% (estimada)" : "" });
    }
  }
  return { ok: true, persisted: false, filename: csvFilename("ventas"), content: buildCsv(headers as any, rows as any), rows: rows.length };
}

export async function exportEmployeesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("employees.view");
  if (guard) return guard;
  const headers = [
    { key: "empleado", label: "Empleado" }, { key: "rol", label: "Rol" }, { key: "periodo", label: "Período" },
    { key: "turno", label: "Turno" }, { key: "horas_trabajadas", label: "Horas trabajadas" }, { key: "faltas", label: "Faltas" },
    { key: "llegadas_tarde", label: "Llegadas tarde" }, { key: "adelantos", label: "Adelantos" }, { key: "costo_mes", label: "Costo del mes" },
    { key: "observaciones", label: "Observaciones" },
  ] as const;
  const periodo = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  if (isDatabaseMode()) {
    try {
      const resolved = await getDatabaseContext();
      if (!resolved) return { ok: false, persisted: false, error: "No hay un negocio autenticado para exportar." };
      const { db, businessId } = resolved;
      const res = await db.from("employees")
        .select("full_name, role, shift, monthly_hours, monthly_cost, pending_advance, absences, late_arrivals, active")
        .eq("business_id", businessId)
        .order("full_name");
      if (res.error) return dbError(res.error);
      const rows = ((res.data as any[]) ?? []).map((e) => ({
        empleado: e.full_name, rol: e.role, periodo, turno: e.shift ?? "", horas_trabajadas: Number(e.monthly_hours ?? 0),
        faltas: Number(e.absences ?? 0), llegadas_tarde: Number(e.late_arrivals ?? 0), adelantos: Number(e.pending_advance ?? 0),
        costo_mes: Number(e.monthly_cost ?? 0), observaciones: e.active ? "" : "Inactivo",
      }));
      const csv = buildCsv(headers as any, rows as any);
      await auditExport(businessId, "employees.exported", "employees", `Exporte CSV novedades · ${rows.length} empleados`);
      return { ok: true, persisted: true, filename: csvFilename("novedades-equipo"), content: csv, rows: rows.length };
    } catch (error) { return dbError(error); }
  }

  const rows = mockEmployees.map((e) => ({ empleado: e.nombre, rol: e.rol, periodo, turno: e.turno, horas_trabajadas: e.horasMes, faltas: e.faltas, llegadas_tarde: e.tardes, adelantos: e.adelantos, costo_mes: e.costoMes, observaciones: e.adelantos > 0 ? `Adelanto a descontar $${e.adelantos.toLocaleString("es-AR")}` : e.tardes > 2 ? "Reincidencia en llegadas tarde" : "" }));
  return { ok: true, persisted: false, filename: csvFilename("novedades-equipo"), content: buildCsv(headers as any, rows as any), rows: rows.length };
}

export async function exportDebtsCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("debts.view");
  if (guard) return guard;
  const headers = [
    { key: "acreedor", label: "Acreedor" }, { key: "categoria", label: "Categoría" }, { key: "organismo", label: "Organismo / Banco" },
    { key: "concepto", label: "Concepto" }, { key: "periodo", label: "Período" }, { key: "vencimiento", label: "Vencimiento" },
    { key: "monto_inicial", label: "Monto inicial" }, { key: "saldo_pendiente", label: "Saldo pendiente" }, { key: "estado", label: "Estado" },
    { key: "tomada", label: "Tomada" }, { key: "saldada_el", label: "Saldada el" },
  ] as const;
  const toRow = (d: any) => ({
    acreedor: d.creditor ?? d.acreedor, categoria: DEBT_CATEGORY_LABELS[(d.category ?? d.categoria) as DebtCategory] ?? d.category ?? d.categoria,
    organismo: d.organism ?? d.organismo ?? "", concepto: d.concept ?? d.concepto ?? "", periodo: d.period ?? d.periodo ?? "",
    vencimiento: d.due_date ?? d.vencimiento ?? "", monto_inicial: Number(d.original_amount ?? d.montoInicial ?? 0),
    saldo_pendiente: Number(d.pending_amount ?? d.saldoPendiente ?? 0), estado: d.status ?? d.estado ?? "",
    tomada: d.taken_at ?? d.tomada ?? "", saldada_el: d.settled_at ?? d.saldadaEl ?? "",
  });

  if (isDatabaseMode()) {
    try {
      const resolved = await getDatabaseContext();
      if (!resolved) return { ok: false, persisted: false, error: "No hay un negocio autenticado para exportar." };
      const { db, businessId } = resolved;
      const res = await db.from("debts")
        .select("creditor, category, organism, concept, period, due_date, original_amount, pending_amount, status, taken_at, settled_at")
        .eq("business_id", businessId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (res.error) return dbError(res.error);
      const rows = ((res.data as any[]) ?? []).map(toRow);
      const csv = buildCsv(headers as any, rows as any);
      await auditExport(businessId, "debts.exported", "debts", `Exporte CSV deudas · ${rows.length} filas`);
      return { ok: true, persisted: true, filename: csvFilename("deudas"), content: csv, rows: rows.length };
    } catch (error) { return dbError(error); }
  }

  const rows = mockDebts.map(toRow);
  return { ok: true, persisted: false, filename: csvFilename("deudas"), content: buildCsv(headers as any, rows as any), rows: rows.length };
}
