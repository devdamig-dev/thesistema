/**
 * Orquestador de extracción.
 *
 * Estrategia:
 *   1. Intenta Claude si hay API key.
 *   2. Si Claude no responde o falla, cae al heurístico.
 *   3. Si todo falla, devuelve `failed` con confidence 0 para que el
 *      flujo persista el mensaje y lo marque como needs_review.
 */

import { claudeExtract } from "./claude";
import { heuristicExtract } from "./heuristic";
import type { ExtractionResult } from "./types";

export async function extractFromMessage(
  messageBody: string,
  sender?: string,
): Promise<ExtractionResult> {
  if (!messageBody || messageBody.trim().length === 0) {
    return {
      movement_type: "unknown",
      confidence: 0,
      detected_fields: {},
      missing_fields: ["message_body"],
      suggested_action: "Pedir el mensaje de nuevo.",
      normalized_summary: "Mensaje vacío",
      target_entity: null,
      source: "failed",
      error: "empty_message",
    };
  }

  const fromClaude = await claudeExtract(messageBody, sender);
  if (fromClaude) return fromClaude;

  try {
    return heuristicExtract(messageBody);
  } catch (error: any) {
    return {
      movement_type: "unknown",
      confidence: 0,
      detected_fields: { raw: messageBody },
      missing_fields: ["type"],
      suggested_action: "Revisar manualmente.",
      normalized_summary: messageBody.slice(0, 80),
      target_entity: null,
      source: "failed",
      error: error?.message ?? "unknown_error",
    };
  }
}

export type { ExtractionResult } from "./types";
