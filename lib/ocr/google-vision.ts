/**
 * Provider OCR · Google Cloud Vision.
 *
 * Activación:
 *   - GOOGLE_VISION_API_KEY (API key con Cloud Vision habilitado)
 *
 * Si la key no está, este provider no se selecciona y caemos al mock.
 *
 * Usa el endpoint REST images:annotate con feature TEXT_DETECTION o
 * DOCUMENT_TEXT_DETECTION (mejor para facturas/PDFs).
 */

import type { OcrInput, OcrProvider, OcrResult } from "./types";

export const googleVisionProvider: OcrProvider = {
  name: "google-vision",
  async extractText(input: OcrInput): Promise<OcrResult> {
    const started = Date.now();
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return {
        provider: "google-vision",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: "missing_api_key",
      };
    }
    if (!input.signedUrl && !input.bytes) {
      return {
        provider: "google-vision",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: "no_input_source",
      };
    }

    try {
      // Vision soporta imageUri (URL pública) o base64.
      const image = input.signedUrl
        ? { source: { imageUri: input.signedUrl } }
        : { content: bytesToBase64(input.bytes!) };

      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image,
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              },
            ],
          }),
        },
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          provider: "google-vision",
          text: "",
          confidence: 0,
          durationMs: Date.now() - started,
          error: `vision_http_${res.status}: ${errText.slice(0, 200)}`,
        };
      }
      const data = (await res.json()) as any;
      const text =
        data?.responses?.[0]?.fullTextAnnotation?.text ??
        data?.responses?.[0]?.textAnnotations?.[0]?.description ??
        "";
      const confidence =
        data?.responses?.[0]?.fullTextAnnotation?.pages?.[0]?.confidence ?? 0.9;
      return {
        provider: "google-vision",
        text,
        confidence,
        durationMs: Date.now() - started,
        raw: data?.responses?.[0],
      };
    } catch (error: any) {
      return {
        provider: "google-vision",
        text: "",
        confidence: 0,
        durationMs: Date.now() - started,
        error: error?.message ?? "vision_unknown_error",
      };
    }
  },
};

function bytesToBase64(bytes: Uint8Array): string {
  // En edge runtime no hay Buffer. Usamos btoa con chunked encoding.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}
