import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const db = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    if (name === "reserve_ai_usage") {
      return { data: { ok: true, allowed: true, usage_id: "11111111-1111-4111-8111-111111111111" }, error: null };
    }
    if (name === "finalize_ai_usage") return { data: { ok: true }, error: null };
    throw new Error("unexpected rpc");
  },
};

const loader = Module as any;
const originalLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
  return originalLoad.call(this, name, ...args);
};
const {
  AI_TASK_CREDITS,
  calculateAiCostMicros,
  routeManagedAiTask,
  runManagedAi,
} = require("../lib/ai/gateway");
loader._load = originalLoad;

test("managed routing keeps operational tasks cheap and escalates analytical work", () => {
  assert.equal(routeManagedAiTask("tool_interpretation"), "gpt-5.6-luna");
  assert.equal(routeManagedAiTask("invoice_extraction"), "gpt-5.6-luna");
  assert.equal(routeManagedAiTask("business_query"), "gpt-5.6-terra");
  assert.equal(routeManagedAiTask("purchase_suggestion"), "gpt-5.6-terra");
  assert.equal(routeManagedAiTask("business_analysis"), "gpt-5.6-sol");
  assert.equal(AI_TASK_CREDITS.tool_interpretation, 1);
  assert.equal(AI_TASK_CREDITS.business_analysis, 8);
});

test("token cost accounting separates cached input from uncached input", () => {
  assert.equal(calculateAiCostMicros("gpt-5.6-luna", {
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 100,
  }), 230);
  assert.equal(calculateAiCostMicros("gpt-5.6-terra", {
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 100,
  }), 3200);
});

test("gateway fails closed before metering when provider is not configured", async () => {
  const prior = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const before = rpcCalls.length;
  const result = await runManagedAi({
    businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    taskType: "tool_interpretation",
    source: "whatsapp",
    instructions: "Return structured JSON.",
    input: "ventas de hoy",
    schemaName: "test",
    schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] },
  });
  assert.deepEqual(result, { ok: false, code: "provider_unconfigured" });
  assert.equal(rpcCalls.length, before);
  if (prior) process.env.OPENAI_API_KEY = prior;
});

test("gateway reserves credits, records real provider usage and finalizes the ledger", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  rpcCalls.length = 0;
  globalThis.fetch = async (_url: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    return new Response(JSON.stringify({
      status: "completed",
      model: "gpt-5.6-luna",
      output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }],
      usage: {
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 500 },
        output_tokens: 100,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const result = await runManagedAi({
      businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      taskType: "tool_interpretation",
      source: "whatsapp",
      instructions: "Return structured JSON.",
      input: "ventas de hoy",
      schemaName: "test",
      schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.usage.credits, 1);
    assert.equal(result.usage.costUsdMicros, 230);
    assert.equal(rpcCalls[0].name, "reserve_ai_usage");
    assert.equal(rpcCalls.at(-1)?.name, "finalize_ai_usage");
    assert.equal(rpcCalls.at(-1)?.args.p_status, "completed");
    assert.equal(rpcCalls.at(-1)?.args.p_cached_input_tokens, 500);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});


test("reused request ids never trigger a second provider call", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key";
  rpcCalls.length = 0;
  let fetchCalls = 0;
  const duplicateDb = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "reserve_ai_usage") {
        return { data: { ok: true, allowed: true, usage_id: "11111111-1111-4111-8111-111111111111", existing: true, status: "completed" }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };

  loader._load = function(name: string, ...args: any[]) {
    if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => duplicateDb };
    return originalLoad.call(this, name, ...args);
  };
  delete require.cache[require.resolve("../lib/ai/gateway")];
  const { runManagedAi: runDuplicate } = require("../lib/ai/gateway");
  loader._load = originalLoad;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider must not be called");
  };

  try {
    const result = await runDuplicate({
      businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      taskType: "tool_interpretation",
      source: "whatsapp",
      instructions: "Return structured JSON.",
      input: "ventas de hoy",
      schemaName: "test",
      schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    assert.deepEqual(result, { ok: false, code: "duplicate_request" });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
