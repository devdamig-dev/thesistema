/**
 * Provider OCR mock.
 *
 * No hace OCR real. Devuelve un texto plausible armado a partir del
 * nombre del archivo. Sirve para:
 *   - desarrollo local sin API keys
 *   - demo mode
 *   - tests
 *
 * Si el filename incluye "carne", "pan", "cheddar", "bebida", etc, arma
 * una factura con esos items para que el extractor pueda hacer matching
 * realista.
 */

import type { OcrInput, OcrProvider, OcrResult } from "./types";

const TEMPLATES: { keywords: string[]; text: string }[] = [
  {
    keywords: ["carne", "frigorifico", "frigorífico", "donjose", "don-jose", "don_jose"],
    text: `FRIGORIFICO DON JOSE S.A.
CUIT 30-71238412-5
Factura A N°: A-0004-00012890
Fecha: ${todayDate()}
Cliente: LA BIRRA BURGER

Descripcion              Cant   Unit       Total
CARNE PREMIUM 180G x KG  20.0   7,438.00   148,760.00

Subtotal:   $148,760.00
IVA 21%:    $ 31,239.60
TOTAL:      $180,000.00

Forma de pago: TRANSFERENCIA`,
  },
  {
    keywords: ["panaderia", "panadería", "espiga", "pan"],
    text: `PANADERIA LA ESPIGA
CUIT 30-66781234-2
Factura B N°: B-0002-00009912
Fecha: ${todayDate()}
Cliente: LA BIRRA BURGER

Descripcion              Cant   Unit     Total
PAN BURGER XL            120    430.00   51,570.00

Subtotal: $51,570.00
IVA 21%:  $10,829.70
TOTAL:    $62,400.00

Pago: Pendiente`,
  },
  {
    keywords: ["serenisima", "serenísima", "cheddar", "queso"],
    text: `LA SERENISIMA
CUIT 30-50000003-2
Factura A N°: A-0011-00345230
Fecha: ${todayDate()}
Cliente: LA BIRRA BURGER

Descripcion              Cant   Unit       Total
CHEDDAR BLOCK 1KG        10.0   6,942.00   69,421.00

Subtotal:   $69,421.00
IVA 21%:    $14,578.41
TOTAL:      $84,000.00

Pago: Cuenta corriente · 14 dias`,
  },
  {
    keywords: ["coca", "cocacola", "bebida", "gaseosa"],
    text: `COCA-COLA FEMSA
CUIT 30-50000694-1
Factura A N°: A-0009-00012501
Fecha: ${todayDate()}
Cliente: LA BIRRA BURGER

Descripcion              Cant   Unit        Total
GASEOSA 500ML PACK x24   4      19,835.00   79,339.00

Subtotal:   $79,339.00
IVA 21%:    $16,661.19
TOTAL:      $96,000.00

Pago: Cuenta corriente · 30 dias`,
  },
];

const DEFAULT_TEMPLATE = `PROVEEDOR DEMO S.R.L.
CUIT 30-99999999-9
Factura B N°: B-0001-00001234
Fecha: ${todayDate()}
Cliente: LA BIRRA BURGER

Descripcion              Cant   Unit     Total
INSUMO GENERICO          5      2,500    12,500.00
PRODUCTO VARIO           3      1,800     5,400.00

Subtotal: $17,900.00
IVA 21%:  $ 3,759.00
TOTAL:    $21,659.00

Pago: Pendiente`;

function todayDate() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}

function pickTemplate(filename?: string): string {
  if (!filename) return DEFAULT_TEMPLATE;
  const lower = filename.toLowerCase();
  for (const tpl of TEMPLATES) {
    if (tpl.keywords.some((k) => lower.includes(k))) return tpl.text;
  }
  return DEFAULT_TEMPLATE;
}

export const mockOcrProvider: OcrProvider = {
  name: "mock",
  async extractText(input: OcrInput): Promise<OcrResult> {
    const started = Date.now();
    // Simulamos latencia realista (300-700ms) para que la UI muestre
    // el estado "processing".
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    const text = pickTemplate(input.filename ?? input.storagePath);
    return {
      provider: "mock",
      text,
      confidence: 0.95,
      durationMs: Date.now() - started,
    };
  },
};
