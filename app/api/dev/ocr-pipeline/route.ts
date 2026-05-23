/**
 * Dev endpoint para validar el pipeline OCR end-to-end.
 *
 * Uso:
 *   curl "http://localhost:3000/api/dev/ocr-pipeline?file=carne.pdf"
 *
 * Devuelve OCR text + extracción IA + matching con ingredients demo.
 * Sin Supabase ni auth. Útil para desarrollo y QA.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractTextFromInvoice } from "@/lib/ocr";
import { extractInvoiceFromText } from "@/lib/ai/invoice-extract";
import { matchAllItems } from "@/lib/ingredients/matching";

const DEMO_INGREDIENTS = [
  { id: "ing-carne", name: "Carne premium 180g" },
  { id: "ing-cheddar", name: "Queso cheddar" },
  { id: "ing-pan", name: "Pan brioche" },
  { id: "ing-gaseosa", name: "Gaseosas 500ml" },
  { id: "ing-bacon", name: "Bacon ahumado" },
];

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get("file") ?? "demo.pdf";

  const ocr = await extractTextFromInvoice({
    storagePath: `demo/${file}`,
    mime: file.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    filename: file,
  });

  const extraction = await extractInvoiceFromText(ocr.text);
  const matched = matchAllItems(extraction.items, DEMO_INGREDIENTS);

  return NextResponse.json({
    ocr: {
      provider: ocr.provider,
      duration_ms: ocr.durationMs,
      confidence: ocr.confidence,
      text_length: ocr.text.length,
      text_preview: ocr.text.split("\n").slice(0, 4).join(" | "),
    },
    extraction: {
      source: extraction.source,
      confidence: extraction.confidence,
      supplier: extraction.supplier,
      tax_id: extraction.tax_id,
      invoice_type: extraction.invoice_type,
      invoice_number: extraction.invoice_number,
      total: extraction.total,
      payment_method: extraction.payment_method,
      items_count: extraction.items.length,
    },
    matching: {
      total: matched.length,
      matched: matched.filter((m) => m.match.status === "matched").length,
      ambiguous: matched.filter((m) => m.match.status === "ambiguous").length,
      unmatched: matched.filter((m) => m.match.status === "unmatched").length,
      details: matched.map((m) => ({
        description: m.description,
        qty: m.qty,
        total: m.total,
        match_status: m.match.status,
        match_score: Number(m.match.score.toFixed(3)),
        suggested: m.match.suggestedId,
      })),
    },
  });
}
