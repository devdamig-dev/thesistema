/**
 * Extracción IA específica para facturas.
 *
 * Toma el texto OCR y devuelve la estructura administrativa que
 * necesitamos para crear la fila en `invoices` + N filas en
 * `invoice_items`.
 *
 * Misma estrategia que `lib/ai/extract.ts`: intenta Claude si hay
 * API key, cae a un parser heurístico robusto. Para la demo y para
 * tests sin LLM, el heurístico cubre los formatos típicos AR.
 */

import { claudeExtract } from "./claude";

export type InvoiceExtractedItem = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  total: number;
};

export type InvoiceExtraction = {
  supplier?: string;
  tax_id?: string;
  invoice_type?: "A" | "B" | "C";
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  currency?: string;
  payment_method?: string;
  items: InvoiceExtractedItem[];
  confidence: number;
  source: "claude" | "heuristic" | "failed";
  error?: string;
};

const NUMERIC_AR = /([\d.,]+)/;

/**
 * Parsea cantidades en pesos argentinos, soportando formatos:
 *   - AR puro:   "180.000,50"   → 180000.5
 *   - US-like:   "148,760.00"   → 148760.00
 *   - Sin sep:   "180000"        → 180000
 *   - Compactos: "180mil", "30k", "1.2M" → 180000, 30000, 1200000
 *
 * Detecta el decimal por la cantidad de dígitos después del último
 * separador (1-2 dígitos = decimal, 3 = miles).
 */
export function parseArs(input: string | undefined | null): number | undefined {
  if (!input) return undefined;
  const cleaned = input.toString().replace(/\$/g, "").trim();
  if (!cleaned) return undefined;

  // Formatos compactos
  const compact = cleaned.toLowerCase().replace(/\s/g, "");
  const m = compact.match(/^(\d+(?:[.,]\d+)?)([mk]|mil)$/);
  if (m) {
    const base = parseFloat(m[1].replace(",", "."));
    const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1_000;
    return Math.round(base * mult);
  }

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;

  if (lastDot > -1 && lastComma > -1) {
    // Hay ambos: el más a la derecha es decimal.
    if (lastDot > lastComma) {
      // US: 148,760.00
      normalized = cleaned.replace(/,/g, "");
    } else {
      // AR: 180.000,50
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastDot > -1) {
    const after = cleaned.length - lastDot - 1;
    normalized = after === 3 ? cleaned.replace(/\./g, "") : cleaned;
  } else if (lastComma > -1) {
    const after = cleaned.length - lastComma - 1;
    normalized = after === 3 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const n = Number(normalized.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/* ============================================================================
   HEURÍSTICO — parsea facturas AR estilo formato lineal
   ============================================================================ */

function heuristicInvoiceExtract(text: string): InvoiceExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Header
  let supplier: string | undefined;
  let tax_id: string | undefined;
  let invoice_type: "A" | "B" | "C" | undefined;
  let invoice_number: string | undefined;
  let invoice_date: string | undefined;
  let payment_method: string | undefined;
  let subtotal: number | undefined;
  let tax: number | undefined;
  let total: number | undefined;

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (!supplier && /^[A-ZÁÉÍÓÚÑ0-9 .,&'-]+$/.test(line) && line.length > 5 && line.length < 60) {
      // Primera línea en mayúsculas es probable que sea el proveedor.
      supplier = toTitleCase(line);
    }

    const cuit = line.match(/CUIT\s*[:\-]?\s*(\d{2}-?\d{7,8}-?\d)/i);
    if (cuit) tax_id = cuit[1];

    const factura = line.match(/Factura\s+([ABC])\s+N[°º]?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    if (factura) {
      invoice_type = factura[1].toUpperCase() as "A" | "B" | "C";
      invoice_number = factura[2];
    }

    const fecha = line.match(/Fecha\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (fecha) invoice_date = normalizeDate(fecha[1]);

    if (/forma\s+de\s+pago|pago|payment/i.test(upper)) {
      const after = line.split(/:/)[1]?.trim();
      if (after) payment_method = after;
    }

    if (/^subtotal/i.test(line)) subtotal = parseArs(line.match(NUMERIC_AR)?.[1]);
    if (/^iva/i.test(line)) tax = parseArs(line.match(NUMERIC_AR)?.[1]);
    if (/^total/i.test(line)) total = parseArs(line.match(NUMERIC_AR)?.[1]);
  }

  // Items: líneas que tienen 4+ números separados por espacios (cant, unit, total)
  // o que matchean un patrón "DESC qty unit_price total"
  const items: InvoiceExtractedItem[] = [];
  for (const line of lines) {
    // Skipear líneas de header / totales
    if (/^(subtotal|iva|total|fecha|cuit|cliente|forma|pago)/i.test(line)) continue;
    if (/^factura/i.test(line)) continue;
    if (/^descrip/i.test(line)) continue;

    // Captura "DESCRIPCION ... qty unit_price total"
    const m = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)$/);
    if (!m) continue;

    const description = m[1].trim();
    const qty = Number(m[2].replace(",", ".")) ?? 0;
    const unitPrice = parseArs(m[3]) ?? 0;
    const totalLine = parseArs(m[4]) ?? 0;

    if (qty <= 0 || totalLine <= 0) continue;

    items.push({
      description,
      qty,
      unit: detectUnit(description),
      unit_price: unitPrice,
      total: totalLine,
    });
  }

  // Confidence: alto si tenemos supplier + total + ≥1 item.
  let confidence = 0.4;
  if (supplier) confidence += 0.2;
  if (total) confidence += 0.2;
  if (items.length > 0) confidence += 0.2;

  return {
    supplier,
    tax_id,
    invoice_type,
    invoice_number,
    invoice_date,
    payment_method,
    subtotal,
    tax,
    total,
    currency: "ARS",
    items,
    confidence: Math.min(confidence, 0.97),
    source: "heuristic",
  };
}

function toTitleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b[a-záéíóúñ]/g, (c) => c.toUpperCase());
}

function normalizeDate(d: string): string {
  // 23/05/2026 → 2026-05-23
  const [day, month, yearRaw] = d.split("/");
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function detectUnit(description: string): string {
  const lower = description.toLowerCase();
  if (/\bkg\b|x\s*\d+\s*kg/i.test(lower)) return "kg";
  if (/\bgr\b|\bg\b|\bgramos?\b/i.test(lower)) return "g";
  if (/\bl\b|\blitros?\b|\bml\b/i.test(lower)) return "L";
  if (/\bunidades?\b|\bun\b|\bu\b/i.test(lower)) return "u";
  if (/\bcaja[s]?\b|\bpack\b/i.test(lower)) return "caja";
  return "u";
}

/* ============================================================================
   ORQUESTADOR
   ============================================================================ */

export async function extractInvoiceFromText(text: string): Promise<InvoiceExtraction> {
  if (!text || text.trim().length === 0) {
    return {
      items: [],
      confidence: 0,
      source: "failed",
      error: "empty_ocr_text",
    };
  }

  // Si hay API key de Anthropic, le pedimos un JSON formateado.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const claudeResult = await claudeExtract(
        `Texto OCR de la factura:\n${text}\n\nDevolvé un JSON con: supplier, tax_id, invoice_type (A|B|C), invoice_number, invoice_date (YYYY-MM-DD), subtotal, tax, total, payment_method, items: [{description, qty, unit, unit_price, total}].`,
        "OCR Pipeline",
      );
      if (claudeResult && claudeResult.movement_type !== "unknown") {
        const fields = claudeResult.detected_fields as any;
        return {
          supplier: fields.supplier,
          tax_id: fields.tax_id,
          invoice_type: fields.invoice_type,
          invoice_number: fields.invoice_number,
          invoice_date: fields.invoice_date,
          subtotal: fields.subtotal,
          tax: fields.tax,
          total: fields.total,
          payment_method: fields.payment_method,
          items: Array.isArray(fields.items) ? fields.items : [],
          currency: "ARS",
          confidence: claudeResult.confidence,
          source: "claude",
        };
      }
    } catch {
      // Fall through al heurístico.
    }
  }

  return heuristicInvoiceExtract(text);
}
