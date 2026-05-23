/**
 * Orquestador OCR.
 *
 * Pickea provider según env. Si el provider real falla, cae al mock
 * para que el flujo end-to-end nunca se rompa.
 *
 * Precedencia:
 *   1. OCR_PROVIDER explícito (mindee | google-vision | mock)
 *   2. MINDEE_API_KEY si está
 *   3. GOOGLE_VISION_API_KEY si está
 *   4. mock
 */

import { googleVisionProvider } from "./google-vision";
import { mindeeProvider } from "./mindee";
import { mockOcrProvider } from "./mock";
import type { OcrInput, OcrProvider, OcrResult } from "./types";

export function pickProvider(): OcrProvider {
  const explicit = process.env.OCR_PROVIDER?.toLowerCase();
  if (explicit === "mindee") return mindeeProvider;
  if (explicit === "google-vision") return googleVisionProvider;
  if (explicit === "mock") return mockOcrProvider;
  if (process.env.MINDEE_API_KEY) return mindeeProvider;
  if (process.env.GOOGLE_VISION_API_KEY) return googleVisionProvider;
  return mockOcrProvider;
}

export async function extractTextFromInvoice(input: OcrInput): Promise<OcrResult> {
  const primary = pickProvider();
  const result = await primary.extractText(input);
  if (result.text && !result.error) return result;
  // Si el real falló, intentamos con el mock para no romper el flujo.
  if (primary.name !== "mock") {
    const fallback = await mockOcrProvider.extractText(input);
    return {
      ...fallback,
      error: `primary_failed: ${result.error ?? "unknown"} · used_mock_fallback`,
    };
  }
  return result;
}

export type { OcrInput, OcrProvider, OcrResult } from "./types";
