/**
 * Extracción heurística — fallback offline cuando no hay
 * `ANTHROPIC_API_KEY` o cuando la llamada a Claude falla.
 *
 * No reemplaza al LLM, pero es lo suficientemente robusta como para
 * que el flujo end-to-end funcione en demos y tests con los ejemplos
 * típicos: compras, ventas multi-canal, adelantos, gastos fijos y
 * cierres operativos.
 *
 * Convención:
 *   - Si no se detecta nada, devuelve `unknown` con confidence baja.
 *   - Si detecta el tipo pero le faltan campos, los lista en
 *     `missing_fields` con confidence intermedia (≤ 0.75).
 */

import type { ExtractionResult, MovementType } from "./types";

/* ============================================================================
   helpers de parsing de moneda y números argentinos
   ============================================================================ */

/** Convierte "180.000", "$180.000", "180mil", "1.2M", "30k" → 180000 / 30000 / etc. */
export function parseArsAmount(input: string): number | null {
  if (!input) return null;
  const cleaned = input.toLowerCase().replace(/[\s$]/g, "");

  // 1.2m, 1m, 1.5M
  const mMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)m$/);
  if (mMatch) return Math.round(parseFloat(mMatch[1].replace(",", ".")) * 1_000_000);

  // 30k, 30K
  const kMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)k$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(",", ".")) * 1_000);

  // "180mil" o "180 mil"
  const milMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)mil$/);
  if (milMatch) return Math.round(parseFloat(milMatch[1].replace(",", ".")) * 1_000);

  // "180.000" o "180000"
  const stripped = cleaned.replace(/\.|,/g, "");
  if (/^\d+$/.test(stripped)) return parseInt(stripped, 10);

  return null;
}

/** Busca todas las menciones de monto en un texto. */
function findAmounts(text: string): { value: number; raw: string; index: number }[] {
  const out: { value: number; raw: string; index: number }[] = [];
  const re = /\$\s?[\d.,]+|\b\d+(?:[.,]\d+)?\s?(?:mil|m|k)\b|\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d{4,}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const value = parseArsAmount(raw.replace(/^\$/, ""));
    if (value !== null) out.push({ value, raw, index: m.index });
  }
  return out;
}

/** Detecta si el texto contiene una palabra (case-insensitive, considera diacríticos). */
function has(text: string, word: string): boolean {
  return text.toLowerCase().includes(word.toLowerCase());
}

/** Detecta canal de venta. */
function detectChannel(label: string): string {
  const l = label.toLowerCase();
  if (/(local|sal[oó]n)/.test(l)) return "salon";
  if (/(delivery)/.test(l)) return "delivery";
  if (/(whatsapp|wa\b)/.test(l)) return "whatsapp";
  if (/(pedidos\s*ya|pya)/.test(l)) return "pedidos_ya";
  if (/(rappi)/.test(l)) return "rappi";
  if (/(qr|mercado\s*pago|mp\b)/.test(l)) return "mp_qr";
  return l.trim();
}

/* ============================================================================
   detectores por tipo
   ============================================================================ */

function detectDailyClosure(text: string): ExtractionResult | null {
  const isClosure =
    /efectivo\s*:?\s*\$?/i.test(text) &&
    /total\s*:?\s*\$?/i.test(text) &&
    (has(text, "QR") || has(text, "tarjeta") || has(text, "burgers"));
  if (!isClosure) return null;

  const fields: Record<string, unknown> = {};
  const grab = (re: RegExp): number | undefined => {
    const m = text.match(re);
    return m ? parseArsAmount(m[1]) ?? undefined : undefined;
  };

  fields.cash = grab(/efectivo\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);
  fields.card = grab(/tarjeta\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);
  fields.qr = grab(/qr\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);
  fields.total = grab(/total\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);
  fields.withdrawal = grab(/retiro\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);
  fields.change = grab(/cambio\s*:?\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i);

  // Unidad de negocio + fecha (primera línea)
  const firstLine = text.split(/\n/)[0]?.trim() ?? "";
  const dateMatch = firstLine.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (dateMatch) fields.date = dateMatch[1];
  const businessUnit = firstLine
    .replace(dateMatch?.[1] ?? "", "")
    .trim();
  if (businessUnit) fields.business_unit = businessUnit;

  // Gastos
  const expenses: { amount: number; description: string }[] = [];
  const expensesBlock = text.split(/gastos\s*:?/i)[1];
  if (expensesBlock) {
    const block = expensesBlock.split(/retiro|cambio|burgers|total/i)[0] ?? "";
    const reExpense = /\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)\s*\(?([^()\n]+)?\)?/gi;
    let m: RegExpExecArray | null;
    while ((m = reExpense.exec(block)) !== null) {
      const amt = parseArsAmount(m[1]);
      const desc = (m[2] ?? "").trim();
      if (amt && amt > 0) expenses.push({ amount: amt, description: desc || "Gasto" });
    }
  }
  if (expenses.length) fields.expenses = expenses;

  // Productos (burgers: 36)
  const products: { name: string; quantity: number }[] = [];
  const reProd = /^([a-záéíóúñ ]+?)\s*:\s*(\d+)\s*$/gim;
  let pm: RegExpExecArray | null;
  while ((pm = reProd.exec(text)) !== null) {
    const name = pm[1].trim().toLowerCase();
    const qty = parseInt(pm[2], 10);
    if (
      !["efectivo", "tarjeta", "qr", "total", "retiro", "cambio", "gastos"].includes(name) &&
      qty > 0
    ) {
      products.push({ name, quantity: qty });
    }
  }
  if (products.length) fields.products = products;

  return {
    movement_type: "daily_closure",
    confidence: 0.78,
    detected_fields: fields,
    missing_fields: [],
    suggested_action: "Aprobar cierre operativo del día.",
    normalized_summary: `Cierre ${fields.business_unit ?? "del día"} · $${Number(fields.total ?? 0).toLocaleString("es-AR")}`,
    target_entity: "daily_closures",
    source: "heuristic",
  };
}

function detectPurchase(text: string): ExtractionResult | null {
  // "compramos 20kg de carne a Don José por 180mil"
  const re = /compramos?\s+(\d+(?:[.,]\d+)?)\s?(kg|g|u|l|ml|cajas?|unidades?)\s+de\s+([\w\sñáéíóú]+?)\s+a\s+([\w\sñáéíóú]+?)\s+por\s+([$\d.,kmilm]+)/i;
  const m = text.match(re);
  if (m) {
    const qty = parseFloat(m[1].replace(",", "."));
    const unit = m[2];
    const item = m[3].trim();
    const supplier = m[4].trim();
    const total = parseArsAmount(m[5]) ?? 0;
    const payment = detectPayment(text);
    const fields: Record<string, unknown> = {
      supplier,
      item,
      quantity: qty,
      unit,
      total_amount: total,
    };
    if (payment) fields.payment_method = payment;
    return {
      movement_type: "purchase",
      confidence: 0.86,
      detected_fields: fields,
      missing_fields: payment ? ["stock_destination"] : ["payment_method", "stock_destination"],
      suggested_action: `Confirmar compra de ${item} a ${supplier} y descargar stock cocina.`,
      normalized_summary: `Compra ${qty}${unit} ${item} · ${supplier} · $${total.toLocaleString("es-AR")}`,
      target_entity: "purchases",
      source: "heuristic",
    };
  }
  return null;
}

function detectSale(text: string): ExtractionResult | null {
  if (!/vendimos|venta|ventas/i.test(text)) return null;
  const channels: { channel: string; amount: number }[] = [];
  // Patrón "local $X, delivery $Y, whatsapp $Z"
  const re = /(local|sal[oó]n|delivery|whatsapp|wa\b|pedidos\s*ya|pya|rappi|qr|mercado\s*pago|mp\b)\s*\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const channel = detectChannel(m[1]);
    const value = parseArsAmount(m[2]);
    if (value) channels.push({ channel, amount: value });
  }

  // Total: la cifra más grande mencionada
  const amounts = findAmounts(text);
  const total = amounts.length
    ? amounts.reduce((a, b) => (b.value > a ? b.value : a), 0)
    : channels.reduce((s, c) => s + c.amount, 0);

  if (channels.length === 0 && total === 0) return null;

  return {
    movement_type: "sale",
    confidence: channels.length ? 0.9 : 0.65,
    detected_fields: {
      total_amount: total || channels.reduce((s, c) => s + c.amount, 0),
      channels,
      date: /hoy/i.test(text) ? "hoy" : /ayer/i.test(text) ? "ayer" : undefined,
    },
    missing_fields: channels.length ? [] : ["channels"],
    suggested_action: "Aprobar cierre de ventas del día.",
    normalized_summary: `Ventas $${(total || channels.reduce((s, c) => s + c.amount, 0)).toLocaleString("es-AR")} · ${channels.length} canales`,
    target_entity: "sales",
    source: "heuristic",
  };
}

function detectAdvance(text: string): ExtractionResult | null {
  // "A Juan le dimos un adelanto de $30.000" / "Juan adelanto 30 mil"
  const re1 = /a\s+([a-záéíóúñ ]+?)\s+(?:le\s+)?(?:dimos|paso|pasamos|di)?\s*(?:un\s+)?adelanto(?:\s+de)?\s+\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i;
  const re2 = /adelanto\s+(?:a\s+)?([a-záéíóúñ ]+?)\s+\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i;
  const m = text.match(re1) ?? text.match(re2);
  if (!m) return null;
  const employee = m[1].trim().split(/\s+/)[0]; // primer nombre
  const amount = parseArsAmount(m[2]);
  if (!amount) return null;
  return {
    movement_type: "employee_advance",
    confidence: 0.88,
    detected_fields: { employee_name: capitalize(employee), amount },
    missing_fields: [],
    suggested_action: `Registrar adelanto a ${capitalize(employee)}.`,
    normalized_summary: `Adelanto ${capitalize(employee)} · $${amount.toLocaleString("es-AR")}`,
    target_entity: "advance_payments",
    source: "heuristic",
  };
}

function detectExpense(text: string): ExtractionResult | null {
  // "El alquiler de mayo fue $450.000" / "Pagamos servicios $142.000"
  const expenseHints = [
    { rx: /alquiler/i, concept: "Alquiler", category: "Alquiler" },
    { rx: /sueldos?/i, concept: "Sueldos", category: "Sueldos" },
    { rx: /servicios|luz|gas|agua|internet/i, concept: "Servicios", category: "Servicios" },
    { rx: /contador/i, concept: "Contador", category: "Profesional" },
    { rx: /publicidad|meta\s*ads|google\s*ads/i, concept: "Publicidad", category: "Marketing" },
  ];
  const hit = expenseHints.find((h) => h.rx.test(text));
  if (!hit) return null;
  const amounts = findAmounts(text);
  if (!amounts.length) return null;
  const total = amounts[0].value;
  return {
    movement_type: "expense",
    confidence: 0.82,
    detected_fields: {
      concept: hit.concept,
      amount: total,
      category: hit.category,
      payment_method: detectPayment(text),
    },
    missing_fields: [],
    suggested_action: `Registrar gasto de ${hit.concept.toLowerCase()}.`,
    normalized_summary: `Gasto ${hit.concept} · $${total.toLocaleString("es-AR")}`,
    target_entity: "expenses",
    source: "heuristic",
  };
}

function detectStockUpdate(text: string): ExtractionResult | null {
  // "Quedan 8kg de cheddar" / "Stock cheddar: 8kg"
  const re = /(?:quedan|stock\s+de|quedan(?:os)?)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|u|l|ml|unidades?)\s+(?:de\s+)?([\w\sñáéíóú]+)/i;
  const m = text.match(re);
  if (!m) return null;
  return {
    movement_type: "stock_update",
    confidence: 0.78,
    detected_fields: {
      ingredient: m[3].trim(),
      qty: parseFloat(m[1].replace(",", ".")),
      unit: m[2],
      reason: "manual_adjust",
    },
    missing_fields: [],
    suggested_action: "Actualizar stock manual.",
    normalized_summary: `Stock ${m[3].trim()} · ${m[1]}${m[2]}`,
    target_entity: "stock_movements",
    source: "heuristic",
  };
}

function detectPriceChange(text: string): ExtractionResult | null {
  // "El proveedor de pan aumentó 12%"
  const m = text.match(/(?:proveedor\s+de\s+)?([\w\sñáéíóú]+?)\s+(?:aument[oó]|sub[ií][oó])\s+(\d+(?:[.,]\d+)?)\s*%/i);
  if (!m) return null;
  return {
    movement_type: "supplier_price_change",
    confidence: 0.7,
    detected_fields: {
      item: m[1].trim(),
      percentage: parseFloat(m[2].replace(",", ".")),
    },
    missing_fields: ["new_unit_price"],
    suggested_action: "Recalcular costo de productos afectados.",
    normalized_summary: `Aumento ${m[1].trim()} +${m[2]}%`,
    target_entity: null,
    source: "heuristic",
  };
}

function detectDebtCreated(text: string): ExtractionResult | null {
  // "Le debemos $300.000 a Don José, vence el viernes"
  // "Tomamos deuda de $1.200.000 para comprar equipamiento"
  const debemos = text.match(
    /(?:le\s+)?debemos\s+\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)\s+a\s+([\w\sñáéíóú.]+?)(?:[,.\n]|\s+vence|\s+por|$)/i,
  );
  const tomamos = text.match(
    /(?:tomamos|sacamos|pedimos)\s+(?:un\s+)?(?:préstamo|prestamo|deuda|crédito|credito)\s+(?:de\s+)?\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)/i,
  );

  if (!debemos && !tomamos) return null;

  const amount = parseArsAmount(debemos?.[1] ?? tomamos?.[1] ?? "");
  if (!amount) return null;

  let creditor = debemos?.[2]?.trim();
  let concept: string | undefined;

  if (tomamos) {
    // "Tomamos deuda de X para comprar equipamiento" → concepto = lo que sigue a "para"
    const para = text.match(/para\s+([^,.\n]+)/i);
    concept = para?.[1]?.trim();
    // Sin creditor explícito en este formato — lo dejamos como Sin acreedor.
    if (!creditor) creditor = "Sin acreedor especificado";
  }

  // Detectar vencimiento informal
  let due: string | undefined;
  if (/vence\s+(?:el\s+)?lunes/i.test(text)) due = "lunes";
  else if (/vence\s+(?:el\s+)?martes/i.test(text)) due = "martes";
  else if (/vence\s+(?:el\s+)?mi[eé]rcoles/i.test(text)) due = "miércoles";
  else if (/vence\s+(?:el\s+)?jueves/i.test(text)) due = "jueves";
  else if (/vence\s+(?:el\s+)?viernes/i.test(text)) due = "viernes";
  else if (/vence\s+(?:el\s+)?s[aá]bado/i.test(text)) due = "sábado";
  else if (/vence\s+(?:el\s+)?domingo/i.test(text)) due = "domingo";
  else {
    const dateMatch = text.match(/vence\s+(?:el\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
    if (dateMatch) due = dateMatch[1];
  }

  const fields: Record<string, unknown> = {
    creditor: creditor ?? "Sin acreedor",
    original_amount: amount,
  };
  if (concept) fields.concept = concept;
  if (due) fields.due_date = due;

  const missing: string[] = [];
  if (!due) missing.push("due_date");
  if (!concept && !debemos) missing.push("concept");

  return {
    movement_type: "debt_created",
    confidence: 0.84,
    detected_fields: fields,
    missing_fields: missing,
    suggested_action: `Registrar nueva deuda con ${creditor}.`,
    normalized_summary: `Deuda nueva · ${creditor} · $${amount.toLocaleString("es-AR")}`,
    target_entity: "debts",
    source: "heuristic",
  };
}

function detectDebtPayment(text: string): ExtractionResult | null {
  // "Pagamos $80.000 de la deuda con el proveedor de pan"
  const m = text.match(
    /pagamos\s+\$?\s*([\d.,]+(?:\s*mil|\s*m|\s*k)?)\s+(?:de\s+(?:la\s+)?deuda|a\s+cuenta)(?:\s+(?:con|a|de|del)\s+([\w\sñáéíóú]+?))?(?:[,.\n]|$)/i,
  );
  if (!m) return null;
  const amount = parseArsAmount(m[1]);
  if (!amount) return null;
  const creditor = m[2]?.replace(/^(el|la|los|las|proveedor|de|del)\s+/i, "").trim();
  const fields: Record<string, unknown> = {
    amount,
    payment_method: detectPayment(text) ?? "Transferencia",
  };
  if (creditor) fields.creditor = creditor;

  return {
    movement_type: "debt_payment",
    confidence: 0.85,
    detected_fields: fields,
    missing_fields: creditor ? [] : ["creditor"],
    suggested_action: creditor
      ? `Registrar pago de $${amount.toLocaleString("es-AR")} a ${creditor}.`
      : `Registrar pago — confirmar a quién.`,
    normalized_summary: `Pago deuda ${creditor ?? ""} · $${amount.toLocaleString("es-AR")}`.trim(),
    target_entity: "debt_payments",
    source: "heuristic",
  };
}

function detectPayment(text: string): string | undefined {
  if (/transfe(?:rencia)?/i.test(text)) return "Transferencia";
  if (/efectivo|cash/i.test(text)) return "Efectivo";
  if (/tarjeta\s*de\s*cr[eé]dito|cr[eé]dito/i.test(text)) return "Tarjeta de crédito";
  if (/tarjeta\s*de\s*d[eé]bito|d[eé]bito/i.test(text)) return "Tarjeta de débito";
  if (/tarjeta/i.test(text)) return "Tarjeta";
  if (/mercado\s*pago|mp\b|qr/i.test(text)) return "Mercado Pago";
  if (/cheque/i.test(text)) return "Cheque";
  return undefined;
}

function capitalize(s: string) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/* ============================================================================
   orquestador
   ============================================================================ */

const DETECTORS: ((text: string) => ExtractionResult | null)[] = [
  detectDailyClosure,
  detectDebtPayment,   // antes que expense — "Pagamos X de la deuda…"
  detectDebtCreated,   // antes que purchase — "Le debemos X a Y"
  detectPurchase,
  detectSale,
  detectAdvance,
  detectExpense,
  detectStockUpdate,
  detectPriceChange,
];

export function heuristicExtract(text: string): ExtractionResult {
  for (const detect of DETECTORS) {
    const result = detect(text);
    if (result) return result;
  }
  return {
    movement_type: "unknown" as MovementType,
    confidence: 0.2,
    detected_fields: {},
    missing_fields: ["type"],
    suggested_action: "Pedir aclaración por WhatsApp.",
    normalized_summary: text.slice(0, 80),
    target_entity: null,
    source: "heuristic",
  };
}
