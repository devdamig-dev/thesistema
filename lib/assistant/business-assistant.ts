import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { convertQuantity } from "@/lib/recipes/quantities";
import { runManagedAi, type AiTaskType } from "@/lib/ai/gateway";

type ToolName =
  | "business_overview"
  | "sales_summary"
  | "expenses_summary"
  | "purchases_summary"
  | "debts_due"
  | "product_margins"
  | "purchase_suggestion";

type AssistantAnswer =
  | { ok: true; answer: string; tool: ToolName; model: string; credits: number }
  | { ok: false; code: string };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function periodFromQuestion(question: string) {
  const q = question.toLocaleLowerCase("es");
  const now = new Date();
  const end = isoDay(now);
  const start = new Date(now);
  if (/hoy/.test(q)) return { from: end, to: end, label: "hoy" };
  if (/semana/.test(q)) {
    start.setUTCDate(start.getUTCDate() - 6);
    return { from: isoDay(start), to: end, label: "últimos 7 días" };
  }
  if (/mes/.test(q)) {
    start.setUTCDate(1);
    return { from: isoDay(start), to: end, label: "este mes" };
  }
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: isoDay(start), to: end, label: "últimos 30 días" };
}

function chooseTool(question: string): ToolName {
  const q = question.toLocaleLowerCase("es");
  if (/(qué|que).*(comprar|reponer)|comprar.*(semana|mañana)|reposición|reposicion|faltan.*insumos/.test(q)) return "purchase_suggestion";
  if (/deuda|cuota|venc/.test(q)) return "debts_due";
  if (/margen|rentab|producto.*(ganancia|costo)|peor.*producto|mejor.*producto/.test(q)) return "product_margins";
  if (/gasto/.test(q)) return "expenses_summary";
  if (/compra|proveedor/.test(q)) return "purchases_summary";
  if (/venta|vend/.test(q)) return "sales_summary";
  return "business_overview";
}

function applyBranchScope(query: any, field: string, branchIds: string[] | null) {
  if (branchIds === null) return query;
  if (branchIds.length === 0) return null;
  return query.in(field, branchIds);
}

async function salesSummary(db: any, businessId: string, branchIds: string[] | null, from: string, to: string) {
  let query = db.from("sales")
    .select("id,amount,channel,occurred_at,status,source")
    .eq("business_id", businessId)
    .gte("occurred_at", `${from}T00:00:00.000Z`)
    .lte("occurred_at", `${to}T23:59:59.999Z`)
    .neq("status", "voided");
  query = applyBranchScope(query, "branch_id", branchIds);
  if (!query) return { count: 0, total: 0, byChannel: {}, bySource: {} };
  const res = await query.limit(5000);
  if (res.error) throw new Error("sales_read_failed");
  const rows = res.data ?? [];
  const byChannel: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    total += amount;
    byChannel[row.channel ?? "sin_canal"] = (byChannel[row.channel ?? "sin_canal"] ?? 0) + amount;
    bySource[row.source ?? "manual"] = (bySource[row.source ?? "manual"] ?? 0) + amount;
  }
  return { count: rows.length, total, byChannel, bySource };
}

async function expensesSummary(db: any, businessId: string, branchIds: string[] | null, from: string, to: string) {
  let query = db.from("expenses")
    .select("amount,category,status,source,created_at,record_status")
    .eq("business_id", businessId)
    .gte("created_at", `${from}T00:00:00.000Z`)
    .lte("created_at", `${to}T23:59:59.999Z`)
    .neq("record_status", "voided");
  query = applyBranchScope(query, "branch_id", branchIds);
  if (!query) return { count: 0, total: 0, byCategory: {} };
  const res = await query.limit(5000);
  if (res.error) throw new Error("expenses_read_failed");
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of res.data ?? []) {
    const amount = Number(row.amount ?? 0);
    total += amount;
    byCategory[row.category ?? "sin_categoria"] = (byCategory[row.category ?? "sin_categoria"] ?? 0) + amount;
  }
  return { count: (res.data ?? []).length, total, byCategory };
}

async function purchasesSummary(db: any, businessId: string, branchIds: string[] | null, from: string, to: string) {
  let query = db.from("purchases")
    .select("id,total,purchased_at,payment_method,source,record_status")
    .eq("business_id", businessId)
    .gte("purchased_at", from)
    .lte("purchased_at", to)
    .neq("record_status", "voided");
  query = applyBranchScope(query, "branch_id", branchIds);
  if (!query) return { count: 0, total: 0, byMethod: {} };
  const res = await query.limit(5000);
  if (res.error) throw new Error("purchases_read_failed");
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const row of res.data ?? []) {
    const amount = Number(row.total ?? 0);
    total += amount;
    byMethod[row.payment_method ?? "sin_metodo"] = (byMethod[row.payment_method ?? "sin_metodo"] ?? 0) + amount;
  }
  return { count: (res.data ?? []).length, total, byMethod };
}

async function debtsDue(db: any, businessId: string, branchIds: string[] | null) {
  const now = new Date();
  const until = new Date(now);
  until.setUTCDate(until.getUTCDate() + 30);
  let query = db.from("debts")
    .select("id,creditor,concept,pending_amount,due_date,currency,status,installment_count")
    .eq("business_id", businessId)
    .gt("pending_amount", 0)
    .order("due_date", { ascending: true, nullsFirst: false });
  query = applyBranchScope(query, "branch_id", branchIds);
  if (!query) return { totalPending: 0, dueNext30Days: [] };
  const res = await query.limit(100);
  if (res.error) throw new Error("debts_read_failed");
  const rows = res.data ?? [];
  return {
    totalPending: rows.reduce((sum: number, row: any) => sum + Number(row.pending_amount ?? 0), 0),
    dueNext30Days: rows.filter((row: any) => row.due_date && row.due_date <= isoDay(until)).slice(0, 25),
  };
}

async function productMargins(db: any, businessId: string) {
  const res = await db.from("products")
    .select("id,name,category,price,cost,active")
    .eq("business_id", businessId)
    .eq("active", true)
    .limit(500);
  if (res.error) throw new Error("products_read_failed");
  return (res.data ?? []).map((p: any) => {
    const price = Number(p.price ?? 0);
    const cost = Number(p.cost ?? 0);
    return {
      name: p.name,
      category: p.category,
      price,
      cost,
      grossMarginPct: price > 0 ? ((price - cost) / price) * 100 : null,
      grossContribution: price - cost,
    };
  }).sort((a: any,b: any) => (a.grossMarginPct ?? -999) - (b.grossMarginPct ?? -999));
}

async function purchaseSuggestion(db: any, businessId: string, branchIds: string[] | null) {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);

  let salesQuery = db.from("sales")
    .select("id")
    .eq("business_id", businessId)
    .gte("occurred_at", `${isoDay(from)}T00:00:00.000Z`)
    .lte("occurred_at", `${isoDay(now)}T23:59:59.999Z`)
    .neq("status", "voided");
  salesQuery = applyBranchScope(salesQuery, "branch_id", branchIds);
  if (!salesQuery) return { period: "últimos 7 días", recommendations: [], note: "Sin sucursales asignadas." };
  const salesRes = await salesQuery.limit(5000);
  if (salesRes.error) throw new Error("sales_read_failed");
  const saleIds = (salesRes.data ?? []).map((row: any) => row.id);
  if (!saleIds.length) return { period: "últimos 7 días", recommendations: [], note: "No hay ventas suficientes para proyectar consumo." };

  const itemRes = await db.from("sale_items").select("product_id,quantity").eq("business_id", businessId).in("sale_id", saleIds).not("product_id","is",null).limit(10000);
  if (itemRes.error) throw new Error("sale_items_read_failed");
  const productQty = new Map<string,number>();
  for (const row of itemRes.data ?? []) {
    if (!row.product_id) continue;
    productQty.set(row.product_id,(productQty.get(row.product_id)??0)+Number(row.quantity??0));
  }
  const productIds=[...productQty.keys()];
  if (!productIds.length) return { period: "últimos 7 días", recommendations: [], note: "Las ventas no tienen productos vinculados a recetas." };

  const recipesRes=await db.from("recipes").select("id,product_id").in("product_id",productIds).limit(1000);
  if(recipesRes.error) throw new Error("recipes_read_failed");
  const recipes=recipesRes.data??[];
  const recipeIds=recipes.map((r:any)=>r.id);
  if(!recipeIds.length) return { period:"últimos 7 días",recommendations:[],note:"Los productos vendidos todavía no tienen recetas." };

  const [recipeItemsRes,ingredientsRes,stockRes]=await Promise.all([
    db.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").in("recipe_id",recipeIds).not("ingredient_id","is",null).limit(10000),
    db.from("ingredients").select("id,name,unit,avg_unit_cost,active").eq("business_id",businessId).eq("active",true).limit(2000),
    (()=>{ let q=db.from("stock_items").select("ingredient_id,current,min,branch_id"); q=applyBranchScope(q,"branch_id",branchIds); return q ? q.limit(5000) : Promise.resolve({data:[],error:null}); })(),
  ]);
  if(recipeItemsRes.error||ingredientsRes.error||stockRes.error) throw new Error("inventory_read_failed");

  const ingredientMap=new Map<string, any>((ingredientsRes.data??[]).map((i:any)=>[String(i.id),i] as [string,any]));
  const recipeProduct=new Map<string, string>(recipes.map((r:any)=>[String(r.id),String(r.product_id)] as [string,string]));
  const weeklyNeed=new Map<string,number>();
  for(const item of (recipeItemsRes.data??[]) as any[]){
    const ingredient=ingredientMap.get(item.ingredient_id);
    const productId=recipeProduct.get(item.recipe_id);
    const sold=productId ? productQty.get(productId)??0 : 0;
    if(!ingredient||sold<=0||item.quantity==null||!item.unit) continue;
    try {
      const perUnit=convertQuantity(item.quantity,item.unit,ingredient.unit);
      weeklyNeed.set(item.ingredient_id,(weeklyNeed.get(item.ingredient_id)??0)+(perUnit*sold));
    } catch { /* incompatible legacy recipe: omit rather than invent */ }
  }

  const stockByIngredient=new Map<string,{current:number;min:number}>();
  for(const row of (stockRes.data??[]) as any[]){
    const current=stockByIngredient.get(row.ingredient_id)??{current:0,min:0};
    current.current+=Number(row.current??0); current.min+=Number(row.min??0);
    stockByIngredient.set(row.ingredient_id,current);
  }

  const recommendations=[];
  for(const [ingredientId,need] of weeklyNeed){
    const ingredient=ingredientMap.get(ingredientId);
    if(!ingredient) continue;
    const stock=stockByIngredient.get(ingredientId)??{current:0,min:0};
    const target=Math.max(need,stock.min);
    const suggested=Math.max(0,target-stock.current);
    if(suggested<=0) continue;
    recommendations.push({
      ingredient:ingredient.name,
      unit:ingredient.unit,
      currentStock:stock.current,
      minimumStock:stock.min,
      consumedByLast7DaysSales:need,
      suggestedPurchase:suggested,
      estimatedCost:suggested*Number(ingredient.avg_unit_cost??0),
    });
  }
  recommendations.sort((a,b)=>b.estimatedCost-a.estimatedCost);
  return { period:"últimos 7 días",recommendations:recommendations.slice(0,30),method:"Proyección simple: repetir consumo de recetas observado en ventas de los últimos 7 días y respetar mínimos configurados." };
}

export async function answerBusinessQuestion(question: string): Promise<AssistantAnswer> {
  const ctx=await getCurrentUserContext();
  if(!ctx.isAuthenticated||!ctx.userId||!ctx.businessId) return {ok:false,code:"requires_auth"};
  const db=await createSupabaseServerClient() as any;
  if(!db) return {ok:false,code:"connection_unavailable"};

  const clean=question.trim();
  if(!clean||clean.length>1200) return {ok:false,code:"invalid_question"};
  const tool=chooseTool(clean);
  const period=periodFromQuestion(clean);

  let data:unknown;
  try {
    if(tool==="sales_summary") data=await salesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to);
    else if(tool==="expenses_summary") data=await expensesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to);
    else if(tool==="purchases_summary") data=await purchasesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to);
    else if(tool==="debts_due") data=await debtsDue(db,ctx.businessId,ctx.assignedBranchIds);
    else if(tool==="product_margins") data=await productMargins(db,ctx.businessId);
    else if(tool==="purchase_suggestion") data=await purchaseSuggestion(db,ctx.businessId,ctx.assignedBranchIds);
    else data={
      period,
      sales:await salesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to),
      expenses:await expensesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to),
      purchases:await purchasesSummary(db,ctx.businessId,ctx.assignedBranchIds,period.from,period.to),
      debts:await debtsDue(db,ctx.businessId,ctx.assignedBranchIds),
    };
  } catch {
    return {ok:false,code:"data_unavailable"};
  }

  const taskType:AiTaskType=tool==="purchase_suggestion"?"purchase_suggestion":"business_query";
  const result=await runManagedAi<{answer:string}>({
    businessId:ctx.businessId,
    actorId:ctx.userId,
    taskType,
    source:"web",
    instructions:[
      "Sos el asistente interno de GastroPilot para una pyme.",
      "Respondé exclusivamente a partir del bloque de datos verificados entregado por el backend.",
      "Los datos pueden provenir de cargas manuales, WhatsApp, OCR o automatizaciones; no distingas su confiabilidad por canal salvo que el dato lo indique.",
      "No inventes filas, métricas ni proyecciones no presentes. Si falta información, decilo claramente.",
      "Usá español rioplatense, respuesta breve y accionable. Si hay una proyección, explicá su criterio en una frase.",
      "No afirmes haber modificado datos: este asistente es de consulta y análisis.",
    ].join("\n"),
    input:JSON.stringify({question:clean,tool,period,data}),
    schemaName:"gastropilot_business_answer",
    schema:{type:"object",additionalProperties:false,properties:{answer:{type:"string",minLength:1,maxLength:3000}},required:["answer"]},
    metadata:{assistant_tool:tool},
    maxOutputTokens:900,
  });
  if(!result.ok) return {ok:false,code:result.code};
  return {ok:true,answer:result.data.answer,tool,model:result.usage.model,credits:result.usage.credits};
}
