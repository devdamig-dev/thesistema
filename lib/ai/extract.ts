/**
 * Orquestador legacy de extracción.
 *
 * Este entrypoint no llama proveedores externos por su cuenta. Las llamadas
 * LLM deben pasar por `runManagedAi`, que exige tenant, reserva de créditos
 * y metering durable antes de invocar al proveedor.
 */

import { heuristicExtract } from "./heuristic";
import type { ExtractionResult } from "./types";

export async function extractFromMessage(
  messageBody: string,
  sender?: string,
): Promise<ExtractionResult> {
  void sender;
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
