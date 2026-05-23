/**
 * Cliente Anthropic Claude para extracción IA.
 *
 * Si `ANTHROPIC_API_KEY` no está seteada, devuelve `null` y el caller
 * cae al heurístico.
 *
 * Uso de modelos: Claude Haiku para extracción (rápido + barato).
 * Si querés más precisión cambiá a Sonnet o Opus modificando `MODEL_ID`.
 */

import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { ExtractionResult } from "./types";

const MODEL_ID = process.env.ANTHROPIC_MODEL_ID ?? "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

interface AnthropicResponse {
  content: { type: string; text: string }[];
}

export async function claudeExtract(
  messageBody: string,
  sender?: string,
): Promise<ExtractionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildUserPrompt(messageBody, sender) },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[claude] HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = (await res.json()) as AnthropicResponse;
    const textBlock = data.content?.find((b) => b.type === "text")?.text ?? "";

    // Claude a veces envuelve el JSON en ```json. Sacamos cualquier fence.
    const cleaned = textBlock
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Omit<ExtractionResult, "source">;
    return { ...parsed, source: "claude" };
  } catch (error) {
    console.error("[claude] extraction failed:", error);
    return null;
  }
}
