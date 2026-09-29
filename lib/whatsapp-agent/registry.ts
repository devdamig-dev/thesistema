import { permissionsFor } from "../permissions";
import type { AgentActor, ToolDefinition } from "./types";

export const WHATSAPP_TOOLS: readonly ToolDefinition[] = [
  { name: "sales.getToday", description: "Consultar ventas de hoy", module: "sales", permission: "sales.view", risk: "READ", required: [] },
  { name: "sales.getPeriod", description: "Consultar ventas por período", module: "sales", permission: "sales.view", risk: "READ", required: ["from", "to"] },
  { name: "sales.comparePeriods", description: "Comparar ventas entre períodos", module: "sales", permission: "sales.view", risk: "READ", required: ["from", "to", "previousFrom", "previousTo"] },
  { name: "purchases.list", description: "Consultar compras", module: "purchases", permission: "purchases.view", risk: "READ", required: [] },
  { name: "purchases.create", description: "Registrar una compra", module: "purchases", permission: "purchases.create", risk: "WRITE", required: ["supplier", "amount", "paymentMethod"] },
  { name: "debts.list", description: "Consultar deudas", module: "debts", permission: "debts.view", risk: "READ", required: [] },
  { name: "debts.create", description: "Registrar una deuda", module: "debts", permission: "debts.create", risk: "WRITE", required: ["creditor", "amount"] },
  { name: "debts.registerPayment", description: "Registrar pago de deuda", module: "debts", permission: "debts.pay", risk: "SENSITIVE", required: ["creditor"] },
  { name: "stock.getLowStock", description: "Consultar stock bajo", module: "stock", permission: "stock.view", risk: "READ", required: [] },
  { name: "stock.addMovement", description: "Registrar movimiento de stock", module: "stock", permission: "stock.adjust", risk: "WRITE", required: ["ingredient", "quantity", "operation"] },
  { name: "products.list", description: "Consultar productos", module: "products", permission: "products.view", risk: "READ", required: [] },
  { name: "products.create", description: "Crear producto", module: "products", permission: "products.edit_price", risk: "WRITE", required: ["name", "price"] },
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
