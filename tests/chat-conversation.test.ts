import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
const loader = Module as any;
const original = loader._load;
let calls = 0;
let providerResult: any = { ok: false, code: "provider_unconfigured" };
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/ai/gateway") return { runManagedAi: async () => { calls++; return providerResult; } };
  return original.call(this, name, ...args);
};
const { answerInternalChat } = require("../lib/chat/conversation");
loader._load = original;

const context = { businessId: "business-a", actorId: "actor-a" };
test("how-to sale help responds without calling provider or writing business data", async () => {
  calls = 0;
  const result = await answerInternalChat({ ...context, text: "¿Cómo cargo las ventas?", tools: [{ name: "sales.getToday", module: "sales", description: "Ventas del día", required: [], risk: "READ", permission: "sales.view" }] });
  assert.equal(result.status, "completed");
  assert.match(result.text, /Ventas/);
  assert.match(result.text, /confirm/);
  assert.equal(calls, 0);
});
test("connection question describes the configured provider without claiming a WhatsApp delivery", async () => {
  calls = 0;
  const result = await answerInternalChat({ ...context, text: "¿Ya estás conectada?", tools: [] });
  assert.match(result.text, /OpenAI/);
  assert.match(result.text, /no comprueba/);
  assert.equal(calls, 0);
});
test("unavailable provider is explicit and cannot report a completed operation", async () => {
  calls = 0; providerResult = { ok: false, code: "provider_unconfigured" };
  const result = await answerInternalChat({ ...context, text: "Explicame cómo organizar mi jornada", tools: [] });
  assert.equal(calls, 1);
  assert.equal(result.status, "failed");
  assert.match(result.text, /no está configurado/);
  assert.doesNotMatch(result.text, /guardado correctamente/i);
});
test("quota exhaustion is reported without attempting a financial write", async () => {
  calls = 0; providerResult = { ok: false, code: "quota_exceeded" };
  const result = await answerInternalChat({ ...context, text: "Quiero consejos para el negocio", tools: [] });
  assert.equal(result.status, "needs_input");
  assert.match(result.text, /límite/);
});
