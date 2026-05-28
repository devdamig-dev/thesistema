"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";
import { buildCsv, csvFilename } from "@/lib/csv";
import {
  recentPurchases,
  topSuppliers,
  invoices as mockInvoices,
  dailySalesTable,
  salesByChannel,
  employees as mockEmployees,
  debts as mockDebts,
  DEBT_CATEGORY_LABELS,
  type Debt,
  type DebtCategory,
} from "@/lib/mock-data";

export type ExportResult =
  | { ok: true; persisted: boolean; filename: string; content: string; rows: number }
  | { ok: false; persisted: boolean; error: string };

async function resolveBusinessId(db: any): Promise<string | null> {
  const res = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

/* ============================================================================
   exportPurchasesCsvAction
   --------------------------------------------------------------------------
   Exportable contable de compras. Cubre los campos clave que el
   contador necesita para conciliar y declarar IVA: fecha, proveedor,
   CUIT, tipo y número de factura, subtotal, IVA, total, medio de pago,
   estado IA, estado aprobación y observaciones.
   ============================================================================ */
export async function exportPurchasesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("purchases.view");
  if (guard) return guard;

  const headers = [
    { key: "fecha", label: "Fecha" },
    { key: "proveedor", label: "Proveedor" },
    { key: "cuit", label: "CUIT" },
    { key: "tipo", label: "Tipo" },
    { key: "punto_venta", label: "Punto de venta" },
    { key: "numero", label: "Número" },
    { key: "subtotal", label: "Subtotal" },
    { key: "iva", label: "IVA" },
    { key: "otros_impuestos", label: "Otros impuestos" },
    { key: "total", label: "Total" },
    { key: "medio_pago", label: "Medio de pago" },
    { key: "categoria", label: "Categoría" },
    { key: "estado_ia", label: "Estado IA" },
    { key: "estado_aprobacion", label: "Estado aprobación" },
    { key: "adjunto", label: "Adjunto" },
    { key: "observaciones", label: "Observaciones" },
  ] as const;

  // Database mode: leer invoices reales del business activo.
  if (isDatabaseMode()) {
    try {
      const db = createSupabaseAdminClient() as any;
      const businessId = await resolveBusinessId(db);
      if (businessId) {
        const res = await db
          .from("invoices")
          .select(
            "id, invoice_date, number, type, tax_id, subtotal, tax, total, payment_method, status, confidence, ai_provider, supplier_id, storage_path, suppliers(name, tax_id)",
          )
          .eq("business_id", businessId)
          .order("invoice_date", { ascending: false })
          .limit(1000);
        const rows = (res.data as any[]) ?? [];
        if (rows.length > 0) {
          const data = rows.map((r) => {
            const [pv, num] = String(r.number ?? "").split("-").slice(-2);
            return {
              fecha: r.invoice_date ?? "",
              proveedor: r.suppliers?.name ?? "—",
              cuit: r.suppliers?.tax_id ?? r.tax_id ?? "",
              tipo: r.type ?? "",
              punto_venta: pv ?? "",
              numero: num ?? r.number ?? "",
              subtotal: Number(r.subtotal ?? 0),
              iva: Number(r.tax ?? 0),
              otros_impuestos: 0,
              total: Number(r.total ?? 0),
              medio_pago: r.payment_method ?? "",
              categoria: "Compra",
              estado_ia: r.ai_provider ?? "—",
              estado_aprobacion: r.status ?? "",
              adjunto: r.storage_path ? "Sí" : "No",
              observaciones: r.confidence != null ? `IA ${Math.round(Number(r.confidence) * 100)}%` : "",
            };
          });
          const csv = buildCsv(headers as any, data as any);
          await logActivity({
            businessId,
            action: "purchases.exported",
            targetType: "invoices",
            summary: `Exporte CSV compras · ${data.length} filas`,
          }).catch(() => {});
          return {
            ok: true,
            persisted: true,
            filename: csvFilename("compras"),
            content: csv,
            rows: data.length,
          };
        }
      }
    } catch (error: any) {
      // Fall through al demo si algo falla.
      console.error("[export.purchases] db failed:", error?.message);
    }
  }

  // Demo: usamos invoices mock + recentPurchases como suplemento.
  const fromInvoices = mockInvoices.map((inv) => {
    const [tipoPrefix, pv, num] = inv.numero.split("-");
    return {
      fecha: inv.fecha,
      proveedor: inv.proveedor,
      cuit: inv.cuit,
      tipo: inv.tipo,
      punto_venta: pv ?? "",
      numero: num ?? "",
      subtotal: inv.subtotal,
      iva: inv.iva,
      otros_impuestos: 0,
      total: inv.total,
      medio_pago: inv.metodoPago,
      categoria: "Compra",
      estado_ia: `${Math.round(inv.confidence * 100)}% confianza`,
      estado_aprobacion: inv.status,
      adjunto: inv.source === "pdf" ? "PDF" : "Imagen",
      observaciones: inv.items.map((i) => i.desc).join(" · "),
    };
  });
  const csv = buildCsv(headers as any, fromInvoices as any);
  return {
    ok: true,
    persisted: false,
    filename: csvFilename("compras"),
    content: csv,
    rows: fromInvoices.length,
  };
}

/* ============================================================================
   exportSalesCsvAction
   --------------------------------------------------------------------------
   Exportable de ventas con campos tributarios: fecha, sucursal, canal,
   medio de pago, bruto, descuentos, comisiones, neto, IVA estimado y
   origen del dato. Útil para que el contador concilie con la grilla
   de facturación y los reportes de PedidosYa / WhatsApp.
   ============================================================================ */
export async function exportSalesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("sales.view");
  if (guard) return guard;

  const headers = [
    { key: "fecha", label: "Fecha" },
    { key: "sucursal", label: "Sucursal" },
    { key: "canal", label: "Canal" },
    { key: "medio_pago", label: "Medio de pago" },
    { key: "importe_bruto", label: "Importe bruto" },
    { key: "descuentos", label: "Descuentos" },
    { key: "comisiones", label: "Comisiones" },
    { key: "importe_neto", label: "Importe neto" },
    { key: "iva_estimado", label: "IVA estimado (21%)" },
    { key: "origen", label: "Origen del dato" },
    { key: "observaciones", label: "Observaciones" },
  ] as const;

  // En database mode podríamos leer `sales` (no existe todavía como
  // tabla seedeada) — para el sprint contable, generamos el exportable
  // a partir de `dailySalesTable` que es lo que la UI muestra hoy.
  const rows: any[] = [];
  // Comisiones aproximadas por canal — espejan los % que ya muestra la UI.
  const COMMISSION = {
    "Salón": 0,
    "Delivery propio": 0,
    "PedidosYa": 0.22,
    "WhatsApp": 0,
  } as const;

  for (const d of dailySalesTable) {
    const entries: { canal: keyof typeof COMMISSION; bruto: number }[] = [
      { canal: "Salón", bruto: d.salon },
      { canal: "Delivery propio", bruto: d.delivery },
      { canal: "PedidosYa", bruto: d.pya },
      { canal: "WhatsApp", bruto: d.wa },
    ];
    for (const e of entries) {
      if (e.bruto <= 0) continue;
      const com = Math.round(e.bruto * COMMISSION[e.canal]);
      const neto = e.bruto - com;
      const iva = Math.round((neto / 1.21) * 0.21);
      rows.push({
        fecha: d.fecha,
        sucursal: "Casa Central",
        canal: e.canal,
        medio_pago: e.canal === "WhatsApp" ? "Transferencia" : e.canal === "PedidosYa" ? "App" : "Mixto",
        importe_bruto: e.bruto,
        descuentos: 0,
        comisiones: com,
        importe_neto: neto,
        iva_estimado: iva,
        origen: e.canal === "Salón" ? "Cierre de caja" : "Conciliación canal",
        observaciones: e.canal === "PedidosYa" ? "Comisión 22% (estimada)" : "",
      });
    }
  }

  const csv = buildCsv(headers as any, rows as any);

  if (isDatabaseMode()) {
    try {
      const db = createSupabaseAdminClient() as any;
      const businessId = await resolveBusinessId(db);
      if (businessId) {
        await logActivity({
          businessId,
          action: "sales.exported",
          targetType: "sales",
          summary: `Exporte CSV ventas · ${rows.length} filas`,
        }).catch(() => {});
      }
    } catch {}
  }

  return {
    ok: true,
    persisted: isDatabaseMode(),
    filename: csvFilename("ventas"),
    content: csv,
    rows: rows.length,
  };
}

/* ============================================================================
   exportEmployeesCsvAction
   --------------------------------------------------------------------------
   Exportable de novedades de nómina: rol, horas, adelantos, faltas,
   llegadas tarde, costo total y observaciones. Sirve para que el
   estudio contable cierre la liquidación mensual sin pedir capturas.
   ============================================================================ */
export async function exportEmployeesCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("employees.view");
  if (guard) return guard;

  const headers = [
    { key: "empleado", label: "Empleado" },
    { key: "rol", label: "Rol" },
    { key: "periodo", label: "Período" },
    { key: "turno", label: "Turno" },
    { key: "horas_trabajadas", label: "Horas trabajadas" },
    { key: "faltas", label: "Faltas" },
    { key: "llegadas_tarde", label: "Llegadas tarde" },
    { key: "adelantos", label: "Adelantos" },
    { key: "costo_mes", label: "Costo del mes" },
    { key: "observaciones", label: "Observaciones" },
  ] as const;

  const periodo = new Date().toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });

  const rows = mockEmployees.map((e) => ({
    empleado: e.nombre,
    rol: e.rol,
    periodo,
    turno: e.turno,
    horas_trabajadas: e.horasMes,
    faltas: e.faltas,
    llegadas_tarde: e.tardes,
    adelantos: e.adelantos,
    costo_mes: e.costoMes,
    observaciones:
      e.adelantos > 0
        ? `Adelanto a descontar $${e.adelantos.toLocaleString("es-AR")}`
        : e.tardes > 2
          ? "Reincidencia en llegadas tarde"
          : "",
  }));

  const csv = buildCsv(headers as any, rows as any);

  if (isDatabaseMode()) {
    try {
      const db = createSupabaseAdminClient() as any;
      const businessId = await resolveBusinessId(db);
      if (businessId) {
        await logActivity({
          businessId,
          action: "employees.exported",
          targetType: "employees",
          summary: `Exporte CSV novedades · ${rows.length} empleados`,
        }).catch(() => {});
      }
    } catch {}
  }

  return {
    ok: true,
    persisted: isDatabaseMode(),
    filename: csvFilename("novedades-equipo"),
    content: csv,
    rows: rows.length,
  };
}

/* ============================================================================
   exportDebtsCsvAction
   --------------------------------------------------------------------------
   Exportable de deudas con categoría contable. Permite al contador
   filtrar fácil impuestos vs proveedores vs sueldos.
   ============================================================================ */
export async function exportDebtsCsvAction(): Promise<ExportResult> {
  const guard = await assertPermission("debts.view");
  if (guard) return guard;

  const headers = [
    { key: "acreedor", label: "Acreedor" },
    { key: "categoria", label: "Categoría" },
    { key: "organismo", label: "Organismo / Banco" },
    { key: "concepto", label: "Concepto" },
    { key: "periodo", label: "Período" },
    { key: "vencimiento", label: "Vencimiento" },
    { key: "monto_inicial", label: "Monto inicial" },
    { key: "saldo_pendiente", label: "Saldo pendiente" },
    { key: "estado", label: "Estado" },
    { key: "tomada", label: "Tomada" },
    { key: "saldada_el", label: "Saldada el" },
  ] as const;

  function toRow(d: Debt) {
    return {
      acreedor: d.acreedor,
      categoria: DEBT_CATEGORY_LABELS[d.categoria as DebtCategory] ?? d.categoria,
      organismo: d.organismo ?? "",
      concepto: d.concepto,
      periodo: d.periodo ?? "",
      vencimiento: d.vencimiento ?? "",
      monto_inicial: d.montoInicial,
      saldo_pendiente: d.saldoPendiente,
      estado: d.estado,
      tomada: d.tomada,
      saldada_el: d.saldadaEl ?? "",
    };
  }

  const rows = mockDebts.map(toRow);
  const csv = buildCsv(headers as any, rows as any);
  return {
    ok: true,
    persisted: false,
    filename: csvFilename("deudas"),
    content: csv,
    rows: rows.length,
  };
}
