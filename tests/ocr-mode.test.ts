import assert from "node:assert/strict";
import test from "node:test";
import { extractTextFromInvoice, pickProvider } from "../lib/ocr/index.js";
import type { OcrProvider } from "../lib/ocr/types.js";

const input = {
  storagePath: "test/invoice.pdf",
  mime: "application/pdf",
  filename: "invoice.pdf",
};

const failingRealProvider: OcrProvider = {
  name: "mindee",
  async extractText() {
    return {
      provider: "mindee",
      text: "partial but unsafe",
      confidence: 0.2,
      durationMs: 1,
      error: "provider_failed",
    };
  },
};

test("database mode never falls back to fictitious OCR data", async () => {
  const result = await extractTextFromInvoice(input, {
    appMode: "database",
    provider: failingRealProvider,
  });
  assert.equal(result.provider, "mindee");
  assert.equal(result.text, "");
  assert.equal(result.error, "provider_failed");
});

test("database mode rejects the mock provider explicitly", async () => {
  const mockProvider: OcrProvider = {
    name: "mock",
    async extractText() {
      throw new Error("must_not_execute");
    },
  };
  await assert.rejects(
    extractTextFromInvoice(input, { appMode: "database", provider: mockProvider }),
    /ocr_mock_forbidden_in_database_mode/,
  );
});

test("database mode without a configured provider fails closed", () => {
  const previousProvider = process.env.OCR_PROVIDER;
  const previousMindee = process.env.MINDEE_API_KEY;
  const previousVision = process.env.GOOGLE_VISION_API_KEY;
  delete process.env.OCR_PROVIDER;
  delete process.env.MINDEE_API_KEY;
  delete process.env.GOOGLE_VISION_API_KEY;
  try {
    assert.throws(() => pickProvider("database"), /ocr_provider_not_configured/);
  } finally {
    if (previousProvider === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = previousProvider;
    if (previousMindee === undefined) delete process.env.MINDEE_API_KEY;
    else process.env.MINDEE_API_KEY = previousMindee;
    if (previousVision === undefined) delete process.env.GOOGLE_VISION_API_KEY;
    else process.env.GOOGLE_VISION_API_KEY = previousVision;
  }
});

test("demo mode may still use mock OCR for controlled fixtures", async () => {
  const result = await extractTextFromInvoice(input, {
    appMode: "demo",
    provider: failingRealProvider,
  });
  assert.equal(result.provider, "mock");
  assert.match(result.text, /PROVEEDOR DEMO/);
  assert.match(result.error ?? "", /used_mock_fallback/);
});
