import type { SupabaseClient } from "@supabase/supabase-js";
import { permissionsFor, type ModuleKey, type Role } from "@/lib/permissions";
import type { AgentActor, AgentAuditEvent, IncomingAgentMessage, PendingOperation, ToolCall } from "./types";

type Db = SupabaseClient<any, "public", any>;
const normalizePhone = (value: string) => value.replace(/\D/g, "");

export async function resolveActor(db: Db, input: IncomingAgentMessage): Promise<AgentActor | null> {
  const recipient = normalizePhone(input.recipientPhone);
  const sender = normalizePhone(input.senderPhone);
  if (recipient.length < 8 || sender.length < 8) return null;
  const integration = await db.from("whatsapp_integrations").select("business_id").eq("display_phone_number", recipient).eq("status", "connected").maybeSingle();
  let businessId = integration.data?.business_id as string | undefined;
  if (!businessId) {
    const businesses = await db.from("businesses").select("id,whatsapp_phone").eq("whatsapp_connected", true);
    businessId = businesses.data?.find((row: any) => normalizePhone(row.whatsapp_phone ?? "") === recipient)?.id;
  }
  if (!businessId) return null;
  const profiles = await db.from("profiles").select("id,full_name,phone").not("phone", "is", null);
  const profile = profiles.data?.find((row: any) => normalizePhone(row.phone ?? "") === sender);
  if (!profile) return null;
  const memberRes = await db.from("business_members").select("id,role").eq("business_id", businessId).eq("user_id", profile.id).maybeSingle();
  const member = memberRes.data as { id: string; role: Role } | null;
  if (!member || permissionsFor(member.role).length === 0) return null;
  const [modulesRes, branchesRes] = await Promise.all([
    db.from("business_modules").select("module_key").eq("business_id", businessId).eq("enabled", true),
    db.from("branch_assignments").select("branch_id").eq("business_member_id", member.id),
  ]);
  const unrestricted = ["owner", "admin", "manager", "accountant"].includes(member.role);
  return { userId: profile.id, memberId: member.id, businessId, phone: sender, name: profile.full_name ?? input.senderName ?? "Usuario", role: member.role, enabledModules: (modulesRes.data ?? []).map((row: any) => row.module_key as ModuleKey), branchIds: unrestricted ? null : (branchesRes.data ?? []).map((row: any) => row.branch_id) };
}

export async function claimMessage(db: Db, input: IncomingAgentMessage, actor: AgentActor): Promise<boolean> {
  const res = await db.from("whatsapp_agent_messages").insert({ provider_message_id: input.messageId, business_id: actor.businessId, member_id: actor.memberId, sender_phone: actor.phone, recipient_phone: normalizePhone(input.recipientPhone), message: input.text });
  return !res.error;
}

export async function getPending(db: Db, actor: AgentActor): Promise<PendingOperation | null> {
  const res = await db.from("whatsapp_agent_pending_operations").select("id,kind,tool_name,arguments,expires_at").eq("business_id", actor.businessId).eq("member_id", actor.memberId).is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!res.data) return null;
  return { id: res.data.id, actor, kind: res.data.kind, toolCall: { name: res.data.tool_name, arguments: res.data.arguments ?? {} }, expiresAt: res.data.expires_at };
}

export async function savePending(db: Db, operation: Omit<PendingOperation, "id">): Promise<PendingOperation> {
  await db.from("whatsapp_agent_pending_operations").update({ consumed_at: new Date().toISOString() }).eq("business_id", operation.actor.businessId).eq("member_id", operation.actor.memberId).is("consumed_at", null);
  const res = await db.from("whatsapp_agent_pending_operations").insert({ business_id: operation.actor.businessId, member_id: operation.actor.memberId, kind: operation.kind, tool_name: operation.toolCall.name, arguments: operation.toolCall.arguments, expires_at: operation.expiresAt }).select("id").single();
  if (res.error) throw res.error;
  return { ...operation, id: res.data.id };
}

export async function clearPending(db: Db, id: string): Promise<void> {
  const res = await db.from("whatsapp_agent_pending_operations").update({ consumed_at: new Date().toISOString() }).eq("id", id);
  if (res.error) throw res.error;
}

const sanitized = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item) => /token|secret|password|authorization/i.test(key) ? "[REDACTED]" : item));
export async function audit(db: Db, event: AgentAuditEvent): Promise<void> {
  const res = await db.from("whatsapp_agent_audit_logs").insert({ business_id: event.actor.businessId, user_id: event.actor.userId, member_id: event.actor.memberId, phone: event.actor.phone, message_id: event.input.messageId, message: event.input.text, intent: event.intent, module_key: event.module, tool_name: event.tool, arguments: sanitized(event.arguments), result: sanitized(event.result), error: event.error, confirmation_required: event.confirmationRequired ?? false, confirmed: event.confirmed ?? false });
  if (res.error) throw res.error;
}

const branchQuery = (query: any, actor: AgentActor) => actor.branchIds ? (actor.branchIds.length ? query.in("branch_id", actor.branchIds) : query.in("branch_id", ["00000000-0000-0000-0000-000000000000"])) : query;
export async function executeTool(db: Db, actor: AgentActor, call: ToolCall): Promise<unknown> {
  const a = call.arguments as any;
  if ("businessId" in a || "business_id" in a) throw new Error("business_id_not_allowed");
  if (call.name.startsWith("sales.")) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    const period = async (from: string, to: string) => { const res = await branchQuery(db.from("sales").select("amount").eq("business_id", actor.businessId).gte("occurred_at", `${from}T00:00:00-03:00`).lte("occurred_at", `${to}T23:59:59-03:00`), actor); if (res.error) throw res.error; return { count: res.data.length, total: res.data.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0), from, to }; };
    if (call.name === "sales.getToday") return period(today, today);
    if (call.name === "sales.getPeriod") return period(a.from, a.to);
    const [current, previous] = await Promise.all([period(a.from, a.to), period(a.previousFrom, a.previousTo)]); return { current, previous, difference: current.total - previous.total };
  }
  if (call.name === "purchases.list") { const res = await db.from("purchases").select("id,purchased_at,total,payment_method,supplier_id").eq("business_id", actor.businessId).order("purchased_at", { ascending: false }).limit(50); if (res.error) throw res.error; return res.data; }
  if (call.name === "purchases.create") { const supplier = await db.from("suppliers").select("id").eq("business_id", actor.businessId).ilike("name", a.supplier).maybeSingle(); if (!supplier.data) throw new Error("supplier_not_found"); const res = await db.from("purchases").insert({ business_id: actor.businessId, supplier_id: supplier.data.id, purchased_at: a.purchasedAt ?? new Date().toISOString().slice(0, 10), total: Number(a.amount), payment_method: a.paymentMethod, created_by: actor.userId }).select("id").single(); if (res.error) throw res.error; return res.data; }
  if (call.name === "debts.list") { const res = await db.from("debts").select("id,creditor,concept,pending_amount,due_date,status").eq("business_id", actor.businessId).neq("status", "settled").order("due_date"); if (res.error) throw res.error; return res.data; }
  if (call.name === "debts.create") { const res = await db.from("debts").insert({ business_id: actor.businessId, creditor: a.creditor, original_amount: Number(a.amount), pending_amount: Number(a.amount), concept: a.concept, category: a.category ?? "supplier" }).select("id").single(); if (res.error) throw res.error; return res.data; }
  if (call.name === "debts.registerPayment") { const debt = await db.from("debts").select("id,pending_amount").eq("business_id", actor.businessId).ilike("creditor", a.creditor).neq("status", "settled").limit(2); if (debt.error || debt.data?.length !== 1) throw new Error("debt_not_unambiguous"); const amount = Number(a.amount ?? debt.data[0].pending_amount); const res = await db.from("debt_payments").insert({ debt_id: debt.data[0].id, amount, payment_method: a.paymentMethod ?? "Transferencia", paid_at: new Date().toISOString().slice(0, 10) }).select("id").single(); if (res.error) throw res.error; return res.data; }
  if (call.name === "stock.getLowStock") { let query = db.from("stock_items").select("id,branch_id,ingredient_id,current,min,ingredients!inner(name,unit,business_id)").eq("ingredients.business_id", actor.businessId); query = branchQuery(query, actor); const res = await query; if (res.error) throw res.error; return res.data.filter((row: any) => Number(row.min) > 0 && Number(row.current) <= Number(row.min)); }
  if (call.name === "stock.addMovement") { const ingredient = await db.from("ingredients").select("id").eq("business_id", actor.businessId).ilike("name", a.ingredient).maybeSingle(); if (!ingredient.data) throw new Error("ingredient_not_found"); const branchId = a.branchId ?? actor.branchIds?.[0]; if (!branchId || (actor.branchIds && !actor.branchIds.includes(branchId))) throw new Error("branch_not_allowed"); const res = await db.rpc("adjust_stock_for_agent", { p_business_id: actor.businessId, p_ingredient_id: ingredient.data.id, p_branch_id: branchId, p_operation: a.operation, p_quantity: Number(a.quantity) }); if (res.error) throw res.error; return res.data; }
  if (call.name === "products.list") { const res = await db.from("products").select("id,name,category,price,cost,active").eq("business_id", actor.businessId).order("name"); if (res.error) throw res.error; return res.data; }
  if (call.name === "products.create") { const res = await db.from("products").insert({ business_id: actor.businessId, name: a.name, category: a.category ?? "General", price: Number(a.price), cost: Number(a.cost ?? 0), active: true }).select("id").single(); if (res.error) throw res.error; return res.data; }
  if (call.name === "invoices.listPending") { const res = await db.from("invoices").select("id,number,sender,total,invoice_date,status").eq("business_id", actor.businessId).in("status", ["processing", "needs_review"]).order("created_at", { ascending: false }).limit(50); if (res.error) throw res.error; return res.data; }
  throw new Error("tool_not_implemented");
}
