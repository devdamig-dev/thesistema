import type { SupabaseClient } from "@supabase/supabase-js";
import { permissionsFor, type ModuleKey, type Role } from "@/lib/permissions";
import type { AgentActor, AgentAuditEvent, IncomingAgentMessage, PendingOperation, ToolCall } from "./types";

type Db = SupabaseClient<any, "public", any>;
const normalizePhone = (value: string) => value.replace(/\D/g, "");

export async function resolveAuthorizedConversation(db: Db, input: IncomingAgentMessage) {
  const provider = input.provider ?? "meta";
  const conversationId = input.providerConversationId?.trim();
  if (!conversationId) return null;
  const res = await db.from("whatsapp_authorized_conversations")
    .select("id,business_id,branch_id,provider,provider_conversation_id,conversation_type,display_name")
    .eq("provider", provider).eq("provider_conversation_id", conversationId).eq("enabled", true).limit(2);
  if (res.error) throw res.error;
  if (res.data?.length !== 1) return null;
  return res.data[0];
}

export async function resolveActor(db: Db, input: IncomingAgentMessage): Promise<AgentActor | null> {
  const recipient = normalizePhone(input.recipientPhone);
  const sender = normalizePhone(input.senderPhone);
  if (recipient.length < 8 || sender.length < 8) return null;

  const integrationRes = await db
    .from("whatsapp_integrations")
    .select("business_id,display_phone_number")
    .eq("status", "connected");

  // Nunca continuar por el fallback legado si la fuente oficial falló: eso
  // podría resolver otro negocio mientras la integración real es incierta.
  if (integrationRes.error) return null;
  const integrations = (integrationRes.data ?? []).filter(
    (row: any) => normalizePhone(row.display_phone_number ?? "") === recipient,
  );
  if (integrations.length > 1) return null;

  let businessId = integrations[0]?.business_id as string | undefined;
  if (!businessId) {
    const businessesRes = await db
      .from("businesses")
      .select("id,whatsapp_phone")
      .eq("whatsapp_connected", true);

    if (businessesRes.error) return null;
    const businesses = (businessesRes.data ?? []).filter(
      (row: any) => normalizePhone(row.whatsapp_phone ?? "") === recipient,
    );
    if (businesses.length !== 1) return null;
    businessId = businesses[0].id;
  }
  if (!businessId) return null;

  const profilesRes = await db
    .from("profiles")
    .select("id,full_name,phone")
    .eq("active", true)
    .not("phone", "is", null);

  if (profilesRes.error) return null;
  const profiles = (profilesRes.data ?? []).filter(
    (row: any) => normalizePhone(row.phone ?? "") === sender,
  );
  if (profiles.length !== 1) return null;
  const profile = profiles[0];

  const memberRes = await db
    .from("business_members")
    .select("id,role")
    .eq("business_id", businessId)
    .eq("user_id", profile.id)
    .limit(2);

  if (memberRes.error || memberRes.data?.length !== 1) return null;
  const member = memberRes.data[0] as { id: string; role: Role };
  if (permissionsFor(member.role).length === 0) return null;

  const [modulesRes, branchesRes] = await Promise.all([
    db.from("business_modules").select("module_key").eq("business_id", businessId).eq("enabled", true),
    db.from("branch_assignments").select("branch_id").eq("business_member_id", member.id),
  ]);
  if (modulesRes.error || branchesRes.error) return null;

  const unrestricted = ["owner", "admin", "manager", "accountant"].includes(member.role);

  return {
    userId: profile.id,
    memberId: member.id,
    businessId,
    phone: sender,
    name: profile.full_name ?? input.senderName ?? "Usuario",
    role: member.role,
    enabledModules: (modulesRes.data ?? []).map((row: any) => row.module_key as ModuleKey),
    branchIds: unrestricted ? null : (branchesRes.data ?? []).map((row: any) => row.branch_id),
  };
}

export async function claimMessage(
  db: Db,
  input: IncomingAgentMessage,
  actor: AgentActor,
): Promise<boolean> {
  const res = await db.from("whatsapp_agent_messages").insert({
    provider_message_id: input.messageId,
    business_id: actor.businessId,
    member_id: actor.memberId,
    sender_phone: actor.phone,
    recipient_phone: normalizePhone(input.recipientPhone),
    message: input.text,
  });

  if (!res.error) return true;
  if (res.error.code === "23505") return false;
  throw res.error;
}

export async function getPending(db: Db, actor: AgentActor): Promise<PendingOperation | null> {
  const res = await db
    .from("whatsapp_agent_pending_operations")
    .select("id,kind,tool_name,arguments,expires_at")
    .eq("business_id", actor.businessId)
    .eq("member_id", actor.memberId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) throw res.error;
  if (!res.data) return null;

  return {
    id: res.data.id,
    actor,
    kind: res.data.kind,
    toolCall: { name: res.data.tool_name, arguments: res.data.arguments ?? {} },
    expiresAt: res.data.expires_at,
  };
}

export async function savePending(
  db: Db,
  operation: Omit<PendingOperation, "id">,
): Promise<PendingOperation> {
  const consume = await db
    .from("whatsapp_agent_pending_operations")
    .update({ consumed_at: new Date().toISOString() })
    .eq("business_id", operation.actor.businessId)
    .eq("member_id", operation.actor.memberId)
    .is("consumed_at", null);

  if (consume.error) throw consume.error;

  const res = await db
    .from("whatsapp_agent_pending_operations")
    .insert({
      business_id: operation.actor.businessId,
      member_id: operation.actor.memberId,
      kind: operation.kind,
      tool_name: operation.toolCall.name,
      arguments: operation.toolCall.arguments,
      expires_at: operation.expiresAt,
    })
    .select("id")
    .single();

  if (res.error) throw res.error;
  return { ...operation, id: res.data.id };
}

export async function consumePending(
  db: Db,
  id: string,
  actor: AgentActor,
  requireUnexpired = false,
): Promise<boolean> {
  // UPDATE's predicate is rechecked after taking the row lock. Two messages
  // racing on one confirmation cannot both receive a returned row.
  let query = db
    .from("whatsapp_agent_pending_operations")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", actor.businessId)
    .eq("member_id", actor.memberId)
    .is("consumed_at", null);
  if (requireUnexpired) query = query.gt("expires_at", new Date().toISOString());
  const res = await query.select("id").maybeSingle();
  if (res.error) throw res.error;
  return Boolean(res.data);
}

const sanitized = (value: unknown): unknown => {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(
      value,
      (key, item) =>
        /token|secret|password|authorization/i.test(key) ? "[REDACTED]" : item,
    ),
  );
};

export async function audit(db: Db, event: AgentAuditEvent): Promise<void> {
  const res = await db.from("whatsapp_agent_audit_logs").insert({
    business_id: event.actor.businessId,
    user_id: event.actor.userId,
    member_id: event.actor.memberId,
    phone: event.actor.phone,
    message_id: event.input.messageId,
    message: event.input.text,
    intent: event.intent,
    module_key: event.module,
    tool_name: event.tool,
    arguments: sanitized(event.arguments),
    result: sanitized(event.result),
    error: event.error,
    confirmation_required: event.confirmationRequired ?? false,
    confirmed: event.confirmed ?? false,
  });

  if (res.error) throw res.error;
}

const branchQuery = (query: any, actor: AgentActor) =>
  actor.branchIds
    ? actor.branchIds.length
      ? query.in("branch_id", actor.branchIds)
      : query.in("branch_id", ["00000000-0000-0000-0000-000000000000"])
    : query;

async function resolveBranchId(db: Db, actor: AgentActor, requested?: string): Promise<string> {
  if (actor.branchIds) {
    if (requested) {
      if (!actor.branchIds.includes(requested)) throw new Error("branch_not_allowed");
      return requested;
    }
    if (actor.branchIds.length !== 1) throw new Error("branch_ambiguous");
    return actor.branchIds[0];
  }

  if (requested) {
    const res = await db
      .from("branches")
      .select("id")
      .eq("id", requested)
      .eq("business_id", actor.businessId)
      .maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) throw new Error("branch_not_allowed");
    return res.data.id;
  }

  const branches = await db
    .from("branches")
    .select("id")
    .eq("business_id", actor.businessId)
    .order("is_main", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(2);

  if (branches.error) throw branches.error;
  if (!branches.data?.length) throw new Error("branch_not_found");
  if (branches.data.length !== 1) throw new Error("branch_ambiguous");
  return branches.data[0].id;
}

export async function executeTool(db: Db, actor: AgentActor, call: ToolCall): Promise<unknown> {
  const a = call.arguments as any;
  if ("businessId" in a || "business_id" in a) throw new Error("business_id_not_allowed");

  if (call.name.startsWith("sales.")) {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    });
    const period = async (from: string, to: string) => {
      const res = await branchQuery(
        db
          .from("sales")
          .select("amount")
          .eq("business_id", actor.businessId)
          .gte("occurred_at", `${from}T00:00:00-03:00`)
          .lte("occurred_at", `${to}T23:59:59-03:00`),
        actor,
      );
      if (res.error) throw res.error;
      return {
        count: res.data.length,
        total: res.data.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0),
        from,
        to,
      };
    };

    if (call.name === "sales.getToday") return period(today, today);
    if (call.name === "sales.getPeriod") return period(a.from, a.to);

    const [current, previous] = await Promise.all([
      period(a.from, a.to),
      period(a.previousFrom, a.previousTo),
    ]);
    return { current, previous, difference: current.total - previous.total };
  }

  if (call.name === "purchases.list") {
    let query = db
      .from("purchases")
      .select("id,branch_id,purchased_at,total,payment_method,supplier_id")
      .eq("business_id", actor.businessId)
      .order("purchased_at", { ascending: false })
      .limit(50);
    if (actor.branchIds !== null) {
      query = actor.branchIds.length > 0
        ? query.in("branch_id", actor.branchIds)
        : query.in("branch_id", ["00000000-0000-0000-0000-000000000000"]);
    }
    const res = await query;
    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "purchases.create") {
    let branchId: string | null = null;
    if (actor.branchIds !== null) {
      if (actor.branchIds.length !== 1) throw new Error("purchase_branch_ambiguous");
      branchId = actor.branchIds[0];
    } else {
      const branch = await db.from("branches").select("id")
        .eq("business_id", actor.businessId)
        .order("is_main", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1).maybeSingle();
      if (branch.error) throw branch.error;
      branchId = branch.data?.id ?? null;
    }
    if (!branchId) throw new Error("purchase_branch_not_found");

    const supplier = await db
      .from("suppliers")
      .select("id")
      .eq("business_id", actor.businessId)
      .ilike("name", a.supplier)
      .maybeSingle();

    if (supplier.error) throw supplier.error;
    if (!supplier.data) throw new Error("supplier_not_found");

    const res = await db
      .from("purchases")
      .insert({
        business_id: actor.businessId,
        branch_id: branchId,
        supplier_id: supplier.data.id,
        purchased_at: a.purchasedAt ?? new Date().toISOString().slice(0, 10),
        total: Number(a.amount),
        payment_method: a.paymentMethod,
        created_by: actor.userId,
      })
      .select("id")
      .single();

    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "debts.list") {
    let query = db
      .from("debts")
      .select("id,creditor,concept,pending_amount,due_date,status")
      .eq("business_id", actor.businessId)
      .neq("status", "settled")
      .order("due_date");
    query = branchQuery(query, actor);
    const res = await query;
    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "debts.create") {
    const branchId = await resolveBranchId(db, actor, a.branchId);
    const res = await db
      .from("debts")
      .insert({
        business_id: actor.businessId,
        branch_id: branchId,
        creditor: a.creditor,
        original_amount: Number(a.amount),
        pending_amount: Number(a.amount),
        concept: a.concept,
        // category existe desde la migración contable 0011.
        category: a.category ?? "supplier",
      })
      .select("id")
      .single();

    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "debts.registerPayment") {
    let query = db
      .from("debts")
      .select("id,pending_amount")
      .eq("business_id", actor.businessId)
      .ilike("creditor", a.creditor)
      .neq("status", "settled")
      .limit(2);
    query = branchQuery(query, actor);
    const debt = await query;

    if (debt.error) throw debt.error;
    if (debt.data?.length !== 1) throw new Error("debt_not_unambiguous");

    const amount = Number(a.amount ?? debt.data[0].pending_amount);
    const res = await db
      .from("debt_payments")
      .insert({
        debt_id: debt.data[0].id,
        amount,
        payment_method: a.paymentMethod ?? "Transferencia",
        paid_at: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();

    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "stock.getLowStock") {
    let query = db
      .from("stock_items")
      .select("id,branch_id,ingredient_id,current,min,ingredients!inner(name,unit,business_id)")
      .eq("ingredients.business_id", actor.businessId);

    query = branchQuery(query, actor);
    const res = await query;
    if (res.error) throw res.error;

    return res.data.filter(
      (row: any) => Number(row.min) > 0 && Number(row.current) <= Number(row.min),
    );
  }

  if (call.name === "stock.addMovement") {
    const ingredient = await db
      .from("ingredients")
      .select("id")
      .eq("business_id", actor.businessId)
      .ilike("name", a.ingredient)
      .maybeSingle();

    if (ingredient.error) throw ingredient.error;
    if (!ingredient.data) throw new Error("ingredient_not_found");

    const branchId = await resolveBranchId(db, actor, a.branchId);

    const res = await db.rpc("adjust_stock_for_agent", {
      p_business_id: actor.businessId,
      p_ingredient_id: ingredient.data.id,
      p_branch_id: branchId,
      p_operation: a.operation,
      p_quantity: Number(a.quantity),
    });

    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "products.list") {
    const res = await db
      .from("products")
      .select("id,name,category,price,cost,active")
      .eq("business_id", actor.businessId)
      .order("name");
    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "products.create") {
    const res = await db
      .from("products")
      .insert({
        business_id: actor.businessId,
        name: a.name,
        category: a.category ?? "General",
        price: Number(a.price),
        cost: Number(a.cost ?? 0),
        active: true,
      })
      .select("id")
      .single();

    if (res.error) throw res.error;
    return res.data;
  }

  if (call.name === "invoices.listPending") {
    const res = await db
      .from("invoices")
      .select("id,number,sender,total,invoice_date,status")
      .eq("business_id", actor.businessId)
      .in("status", ["processing", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (res.error) throw res.error;
    return res.data;
  }

  throw new Error("tool_not_implemented");
}
