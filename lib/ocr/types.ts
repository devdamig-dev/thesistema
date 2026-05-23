/**
 * Capa OCR — adapter pattern.
 *
 * Cada provider implementa `extractText(input)` y devuelve texto plano
 * con el contenido bruto del comprobante. La interpretación estructurada
 * (proveedor, items, totales) la hace `lib/ai/invoice-extract.ts`
 * a partir de ese texto.
 */

export type OcrInput = {
  /** Path en el bucket, ej: "{org}/{biz}/{uuid}.pdf" */
  storagePath: string;
  /** MIME type del archivo subido */
  mime: string;
  /** Nombre original del archivo (opcional, útil para el provider mock). */
  filename?: string;
  /** URL firmada al archivo (cuando ya está en storage). */
  signedUrl?: string;
  /** Buffer del archivo. Optional — algunos providers prefieren URL. */
  bytes?: Uint8Array;
};

export type OcrResult = {
  /** Texto plano extraído del comprobante. */
  text: string;
  /** Confidence aproximado 0..1 que devuelve el provider. */
  confidence: number;
  /** Nombre del provider que procesó el archivo. */
  provider: "mock" | "google-vision" | "mindee";
  /** Duración del procesamiento en ms. */
  durationMs: number;
  /** Datos crudos del provider para debugging. */
  raw?: unknown;
  /** Si falló, mensaje legible. */
  error?: string;
};

export interface OcrProvider {
  readonly name: OcrResult["provider"];
  extractText(input: OcrInput): Promise<OcrResult>;
}
