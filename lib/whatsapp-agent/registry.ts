import { permissionsFor } from "../permissions";
import type { ModuleKey, Role } from "../permissions";
import type { AgentActor, ToolDefinition } from "./types";

export const WHATSAPP_TOOLS: readonly ToolDefinition[] = [
  { name: "sales.create", description: "Registrar venta detallada con cantidades y precios explícitos", module: "sales", permission: "sales.create", risk: "SENSITIVE", required: [] },
  { name: "sales.edit", description: "Editar venta detallada con control de versión", module: "sales", permission: "sales.create", risk: "SENSITIVE", required: [] },
  { name: "sales.void", description: "Anular venta con motivo e historial", module: "sales", permission: "sales.create", risk: "SENSITIVE", required: [] },
  { name: "sales.getToday", description: "Consultar ventas de hoy", module: "sales", permission: "sales.view", risk: "READ", required: [] },
  { name: "sales.getPeriod", description: "Consultar ventas por período", module: "sales", permission: "sales.view", risk: "READ", required: ["from", "to"] },
  { name: "sales.comparePeriods", description: "Comparar ventas entre períodos", module: "sales", permission: "sales.view", risk: "READ", required: ["from", "to", "previousFrom", "previousTo"] },
  { name: "purchases.list", description: "Consultar compras", module: "purchases", permission: "purchases.view", risk: "READ", required: [] },
  { name: "purchases.create", description: "Registrar compra resumida o detallada con insumos, cantidades, unidades y precios explícitos", module: "purchases", permission: "purchases.create", risk: "SENSITIVE", required: [] },
  { name: "debts.createPlan", description: "Crear una obligación de pago único o un plan con cronograma confirmado", module: "debts", permission: "debts.create", risk: "WRITE", required: [] },
  { name: "debts.getPlan", description: "Consultar saldo, cuotas e historial de una deuda identificada sin ambigüedad", module: "debts", permission: "debts.view", risk: "READ", required: [] },
  { name: "debts.listDue", description: "Consultar cuotas y vencimientos dentro de fechas explícitas", module: "debts", permission: "debts.view", risk: "READ", required: ["from", "to"] },
  { name: "debts.registerPlanPayment", description: "Registrar pago parcial, anticipado o global con imputación explícita", module: "debts", permission: "debts.pay", risk: "SENSITIVE", required: [] },
  { name: "debts.voidPlanPayment", description: "Anular un pago identificado con motivo y auditoría", module: "debts", permission: "debts.pay", risk: "SENSITIVE", required: [] },
  { name: "debts.editPlan", description: "Cambiar notas o vencimiento de una cuota sin alterar términos financieros", module: "debts", permission: "debts.create", risk: "WRITE", required: [] },
  { name: "debts.list", description: "Consultar deudas", module: "debts", permission: "debts.view", risk: "READ", required: [] },
  { name: "debts.create", description: "Crear obligación (alias compatible; requiere contrato completo de plan)", module: "debts", permission: "debts.create", risk: "WRITE", required: [] },
  { name: "debts.registerPayment", description: "Registrar pago de deuda", module: "debts", permission: "debts.pay", risk: "SENSITIVE", required: ["creditor", "amount", "paymentMethod", "paidAt"] },
  { name: "stock.getReplenishment", description: "Consultar reposición con stock actual, mínimo, consumo físico y teórico separados, productos y compras del período", module: "stock", permission: "stock.view", risk: "READ", required: ["branchId", "from", "to"] },
  { name: "stock.getLowStock", description: "Consultar stock bajo", module: "stock", permission: "stock.view", risk: "READ", required: [] },
  { name: "stock.addMovement", description: "Registrar movimiento de stock", module: "stock", permission: "stock.adjust", risk: "WRITE", required: ["ingredient", "quantity", "operation", "reason", "unit"] },
  { name: "products.list", description: "Consultar productos", module: "products", permission: "products.view", risk: "READ", required: [] },
  { name: "products.create", description: "Crear producto con categoría, precio, costo y estado explícitos (composición desde Productos)", module: "products", permission: "products.edit_price", risk: "WRITE", required: ["name", "price", "category", "cost", "active"] },
  { name: "invoices.listPending", description: "Consultar facturas pendientes", module: "invoices_ocr", permission: "invoices.view", risk: "READ", required: [] },
] as const;

export function toolsForActor(actor: AgentActor): ToolDefinition[] {
  const permissions = new Set(permissionsFor(actor.role));
  const modules = new Set(actor.enabledModules);
  return WHATSAPP_TOOLS.filter((tool) => modules.has(tool.module) && permissions.has(tool.permission));
}

export function getTool(name: string): ToolDefinition | undefined {
  return WHATSAPP_TOOLS.find((tool) => tool.name === name);
}

export type CapabilityAvailability = "available" | "module_disabled" | "forbidden";
export type WhatsAppCapability = ToolDefinition & { availability: CapabilityAvailability };

/** Catálogo de producto: siempre parte de las tools ejecutables del registry. */
export function capabilityCatalogFor(role: Role, enabledModules: readonly ModuleKey[]): WhatsAppCapability[] {
  const permissions = new Set(permissionsFor(role));
  const modules = new Set(enabledModules);
  return WHATSAPP_TOOLS.map((tool) => ({
    ...tool,
    availability: !modules.has(tool.module)
      ? "module_disabled"
      : permissions.has(tool.permission)
        ? "available"
        : "forbidden",
  }));
}
