/**
 * Orquestador OCR.
 *
 * Pickea provider según env. El mock queda limitado a demo: en database
 * mode una falla real debe quedar visible y nunca convertirse en datos
 * plausibles pero ficticios.
 *
 * Precedencia:
 *   1. OCR_PROVIDER explícito (mindee | google-vision | mock)
 *   2. MINDEE_API_KEY si está
 *   3. GOOGLE_VISION_API_KEY si está
 *   4. mock sólo en demo; error de configuración en database
 */

import { env, type AppMode } from "../env";
import { googleVisionProvider } from "./google-vision";
import { mindeeProvider } from "./mindee";
import { mockOcrProvider } from "./mock";
import type { OcrInput, OcrProvider, OcrResult } from "./types";

export function pickProvider(appMode: AppMode = env.appMode): OcrProvider {
  const explicit = process.env.OCR_PROVIDER?.toLowerCase();
  if (explicit === "mindee") return mindeeProvider;
  if (explicit === "google-vision") return googleVisionProvider;
  if (explicit === "mock") {
    if (appMode === "database") throw new Error("ocr_mock_forbidden_in_database_mode");
    return mockOcrProvider;
  }
  if (process.env.MINDEE_API_KEY) return mindeeProvider;
  if (process.env.GOOGLE_VISION_API_KEY) return googleVisionProvider;
  if (appMode === "database") throw new Error("ocr_provider_not_configured");
  return mockOcrProvider;
}

type OcrExecutionOptions = {
  appMode?: AppMode;
  provider?: OcrProvider;
};

export async function extractTextFromInvoice(
  input: OcrInput,
  options: OcrExecutionOptions = {},
): Promise<OcrResult> {
  const appMode = options.appMode ?? env.appMode;
  const primary = options.provider ?? pickProvider(appMode);
  if (appMode === "database" && primary.name === "mock") {
    throw new Error("ocr_mock_forbidden_in_database_mode");
  }
  const result = await primary.extractText(input);
  if (result.text && !result.error) return result;
  // Demo conserva un fallback útil. Database mode devuelve el error real.
  if (appMode === "demo" && primary.name !== "mock") {
    const fallback = await mockOcrProvider.extractText(input);
    return {
      ...fallback,
      error: `primary_failed: ${result.error ?? "unknown"} · used_mock_fallback`,
    };
  }
  return { ...result, text: "" };
}

export type { OcrInput, OcrProvider, OcrResult } from "./types";
