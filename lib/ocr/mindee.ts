/**
 * Provider OCR · Mindee Invoice API.
 *
 * Activación:
 *   - MINDEE_API_KEY
 *
 * Mindee tiene un endpoint específico para facturas que devuelve campos
 * estructurados (proveedor, total, IVA, items) ya parseados. Igual lo
 * tratamos como OCR puro: devolvemos el texto crudo en `text` y dejamos
 * la estructura cruda en `raw` para que el extractor IA pueda
 * aprovecharla si quiere.
 */

import type { OcrInput, OcrProvider, OcrResult } from "./types";

const MINDEE_ENDPOINT = "https://api.mindee.net/v1/products/mindee/invoices/v4/predict";

export const mindeeProvider: OcrProvider = {
  name: "mindee",
  async extractText(input: OcrInput): Promise<OcrResult> {
    const started = Date.now();
    const apiKey = process.env.MINDEE_API_KEY;
    if (!apiKey) {
      return {
        provider: "mindee",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: "missing_api_key",
      };
    }
    if (!input.signedUrl && !input.bytes) {
      return {
        provider: "mindee",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: "no_input_source",
      };
    }

    try {
      const form = new FormData();
      if (input.signedUrl) {
        form.append("document_url", input.signedUrl);
      } else if (input.bytes) {
        // Copia el buffer a un ArrayBuffer fresco para conformar el
        // type checker estricto de Blob.
        const ab = new ArrayBuffer(input.bytes.byteLength);
        new Uint8Array(ab).set(input.bytes);
        form.append(
          "document",
          new Blob([ab], { type: input.mime ?? "application/octet-stream" }),
          input.filename ?? "invoice.pdf",
        );
      }

      const res = await fetch(MINDEE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          provider: "mindee",
          text: "",
          confidence: 0,
          durationMs: Date.now() - started,
          error: `mindee_http_${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const data = (await res.json()) as any;
      const prediction = data?.document?.inference?.prediction;
      const text = serializePrediction(prediction);
      const confidence = Number(prediction?.total_amount?.confidence ?? 0.85);
      return {
        provider: "mindee",
        text,
        confidence,
        durationMs: Date.now() - started,
        raw: prediction,
      };
    } catch (error: any) {
      return {
        provider: "mindee",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: error?.message ?? "mindee_unknown_error",
      };
    }
  },
};

/**
 * Serializa el JSON estructurado de Mindee en un texto plano legible
 * que el extractor IA pueda procesar.
 */
function serializePrediction(p: any): string {
  if (!p) return "";
  const supplier = p.supplier_name?.value ?? "";
  const cuit = p.supplier_company_registrations?.[0]?.value ?? "";
  const number = p.invoice_number?.value ?? "";
  const date = p.date?.value ?? "";
  const subtotal = p.total_net?.value ?? "";
  const tax = p.total_tax?.value ?? "";
  const total = p.total_amount?.value ?? "";
  const items: string[] = (p.line_items ?? []).map((li: any) => {
    return `${li.description ?? ""} ${li.quantity ?? ""} ${li.unit_price ?? ""} ${li.total_amount ?? ""}`.trim();
  });

  return [
    supplier,
    cuit ? `CUIT ${cuit}` : "",
    number ? `Factura N°: ${number}` : "",
    date ? `Fecha: ${date}` : "",
    "",
    ...items,
    "",
    subtotal ? `Subtotal: $${subtotal}` : "",
    tax ? `IVA: $${tax}` : "",
    total ? `TOTAL: $${total}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
