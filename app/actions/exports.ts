"use server";
import { withSalesRevision } from "../../lib/sales/read";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canSeeModule } from "@/lib/permissions";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";
import { applyAdminBranchScope } from "@/lib/data/branch-scope";
import { channelLabels, sourceLabels, localDateTime, periodRange, readAllSales, type SalesPeriod } from "@/app/ventas/reporting";
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

/**
 * Los exports usan el cliente administrativo para poder generar archivos
 * server-side, por lo que no reciben el filtro de RLS de la sesión. Replicamos
 * explícitamente el alcance de sucursal resuelto para el actor y fallamos
 * cerrado cuando un rol restringido no tiene asignaciones.
 */
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
      const { ctx, db, businessId } = resolved;
      let query = db.from("invoices")
        .select("invoice_date, number, type, tax_id, subtotal, tax, total, payment_method, status, confidence, ai_provider, storage_path, suppliers(name, tax_id)")
        .eq("business_id", businessId)
        .order("invoice_date", { ascending: false })
        .limit(1000);
      query = applyAdminBranchScope(query, ctx.assignedBranchIds);
      const res = await query;
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

export async function exportSalesCsvAction(period?: SalesPeriod, branchId: string | null = null): Promise<ExportResult> {
  const guard = await assertPermission("sales.view");
  if (guard) return guard;
  const headers = [
    { key: "fecha", label: "Fecha y hora local" }, { key: "zona_horaria", label: "Zona horaria" },
    { key: "sucursal", label: "Sucursal" }, { key: "canal", label: "Canal" },
    { key: "medio_pago", label: "Medio de pago" }, { key: "importe", label: "Importe registrado" },
    { key: "moneda", label: "Moneda" }, { key: "tipo", label: "Tipo de registro" },
    { key: "origen", label: "Origen" }, { key: "estado", label: "Estado" }, { key: "observaciones", label: "Observaciones" },
  ] as const;
  if (isDatabaseMode()) {
    try {
      const resolved = await getDatabaseContext();
      if (!resolved) return { ok: false, persisted: false, error: "No hay un negocio autenticado para exportar." };
      const { ctx, db, businessId } = resolved;
      if (!ctx.userId || !canSeeModule(ctx.role, "sales", ctx.enabledModules)) return { ok: false, persisted: false, error: "El módulo Ventas no está disponible para esta sesión." };
      const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
      if (profile.error || profile.data?.active !== true) return { ok: false, persisted: false, error: "La sesión no está habilitada para exportar ventas." };
      if (period && !["current_month", "previous_month", "last_30_days"].includes(period)) return { ok: false, persisted: false, error: "Período inválido." };
      if (branchId && (!/^[0-9a-f-]{36}$/i.test(branchId) || (ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)))) return { ok: false, persisted: false, error: "Sucursal no disponible." };
      const business = await db.from("businesses").select("timezone").eq("id", businessId).maybeSingle();
      if (business.error || typeof business.data?.timezone !== "string") throw new Error("timezone_unavailable");
      const timezone = business.data.timezone; const range = period ? periodRange(period, timezone) : null;
      const records = await withSalesRevision(db,businessId,()=>readAllSales<any>((from, to) => {
        let query = db.from("sales").select("id, occurred_at, channel, amount, payment_method, currency, sale_kind, source, status, notes, branches(name)", { count: "exact" }).eq("business_id", businessId).eq("status", "active").order("occurred_at", { ascending: false }).order("id").range(from, to);
        query = applyAdminBranchScope(query, ctx.assignedBranchIds);
        if (branchId) query = query.eq("branch_id", branchId);
        if (range) query = query.gte("occurred_at", range.start).lt("occurred_at", range.end);
        return query;
      }));
      const rows = records.map((row) => {
        const branch = Array.isArray(row.branches) ? row.branches[0] : row.branches;
        return { fecha: localDateTime(row.occurred_at, timezone).replace("T", " "), zona_horaria: timezone, sucursal: branch?.name ?? "No informada", canal: channelLabels[row.channel] ?? row.channel ?? "No informado", medio_pago: row.payment_method ?? "No informado", importe: Number(row.amount), moneda: row.currency ?? "No informada", tipo: row.sale_kind === "detailed" ? "Ticket detallado" : row.sale_kind === "summary" ? "Resumen agregado (no es ticket)" : "Histórico sin detalle", origen: sourceLabels[row.source] ?? "No informado", estado: "Activa", observaciones: row.notes ?? "" };
      });
      await auditExport(businessId, "sales.exported", "sales", `Exporte CSV ventas · ${rows.length} registros activos`);
      return { ok: true, persisted: true, filename: csvFilename("ventas"), content: buildCsv(headers as any, rows as any), rows: rows.length };
    } catch (error) { return dbError(error); }
  }
  const rows = dailySalesTable.map((day) => ({ fecha: day.fecha, zona_horaria: "Demo", sucursal: "Casa Central (demo)", canal: "Todos", medio_pago: "Ejemplo", importe: day.total, moneda: "ARS (demo)", tipo: "Resumen de demostración", origen: "Demo", estado: "Demo", observaciones: "Datos ficticios, no persistidos" }));
  return { ok: true, persisted: false, filename: csvFilename("ventas-demo"), content: buildCsv(headers as any, rows as any), rows: rows.length };
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
