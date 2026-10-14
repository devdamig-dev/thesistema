import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AiTaskType =
  | "tool_interpretation"
  | "message_extraction"
  | "invoice_extraction"
  | "business_query"
  | "purchase_suggestion"
  | "recommendation"
  | "business_analysis";

export type AiSource = "whatsapp" | "web" | "inbox" | "ocr" | "automation" | "system";
export type ManagedAiModel = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";

export const AI_TASK_CREDITS: Record<AiTaskType, number> = {
  tool_interpretation: 1,
  message_extraction: 1,
  invoice_extraction: 3,
  business_query: 2,
  purchase_suggestion: 4,
  recommendation: 4,
  business_analysis: 8,
};

type ModelPricing = {
  input: number;
  cachedInput: number;
  output: number;
};

export const AI_MODEL_PRICING_USD_PER_MILLION: Record<ManagedAiModel, ModelPricing> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
};

export function routeManagedAiTask(task: AiTaskType): ManagedAiModel {
  if (task === "business_analysis") return "gpt-5.6-sol";
  if (task === "business_query" || task === "purchase_suggestion" || task === "recommendation") {
    return "gpt-5.6-terra";
  }
  return "gpt-5.6-luna";
}

export function calculateAiCostMicros(
  model: ManagedAiModel,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number },
): number {
  const pricing = AI_MODEL_PRICING_USD_PER_MILLION[model];
  const cached = Math.max(0, Math.min(usage.cachedInputTokens, usage.inputTokens));
  const uncached = Math.max(0, usage.inputTokens - cached);
  // USD-per-million * tokens converts directly to micro-USD.
  return Math.max(0, Math.round(
    uncached * pricing.input +
    cached * pricing.cachedInput +
    Math.max(0, usage.outputTokens) * pricing.output,
  ));
}

type JsonSchema = Record<string, unknown>;

type GatewayInput<T> = {
  businessId: string;
  actorId?: string | null;
  taskType: AiTaskType;
  source: AiSource;
  instructions: string;
  input: string;
  schemaName: string;
  schema: JsonSchema;
  metadata?: Record<string, string>;
  requestId?: string;
  maxOutputTokens?: number;
};

export type GatewaySuccess<T> = {
  ok: true;
  data: T;
  usage: {
    requestId: string;
    usageId: string;
    model: ManagedAiModel;
    credits: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
};

export type GatewayFailure = {
  ok: false;
  code:
    | "provider_unconfigured"
    | "quota_exceeded"
    | "metering_unavailable"
    | "provider_error"
    | "invalid_provider_response"\n    | "duplicate_request";
};

type OpenAiResponse = {
  id?: string;
  model?: string;
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  } | null;
};

function responseText(response: OpenAiResponse): string | null {
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
      if (part.type === "refusal") return null;
    }
  }
  return null;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

async function finalizeUsage(args: {
  businessId: string;
  usageId: string;
  status: "completed" | "failed" | "cancelled";
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsdMicros?: number;
  errorCode?: string | null;
}) {
  try {
    const db = createSupabaseAdminClient() as any;
    if (!db) return;
    await db.rpc("finalize_ai_usage", {
      p_business_id: args.businessId,
      p_usage_id: args.usageId,
      p_status: args.status,
      p_input_tokens: args.inputTokens ?? 0,
      p_cached_input_tokens: args.cachedInputTokens ?? 0,
      p_output_tokens: args.outputTokens ?? 0,
      p_cost_usd_micros: args.costUsdMicros ?? 0,
      p_error_code: args.errorCode ?? null,
    });
  } catch {
    // Never transform a provider result into a claimed business operation.
    // Metering reconciliation is handled from the durable reserved row.
  }
}

export async function runManagedAi<T>(request: GatewayInput<T>): Promise<GatewaySuccess<T> | GatewayFailure> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, code: "provider_unconfigured" };

  const model = routeManagedAiTask(request.taskType);
  const credits = AI_TASK_CREDITS[request.taskType];
  const requestId = request.requestId ?? crypto.randomUUID();
  const db = createSupabaseAdminClient() as any;
  if (!db) return { ok: false, code: "metering_unavailable" };

  const reservation = await db.rpc("reserve_ai_usage", {
    p_business_id: request.businessId,
    p_request_id: requestId,
    p_actor_id: request.actorId ?? null,
    p_task_type: request.taskType,
    p_source: request.source,
    p_provider: "openai",
    p_model: model,
    p_credits: credits,
    p_metadata: request.metadata ?? {},
  });

  const reserved = reservation.data as {
    ok?: boolean;
    allowed?: boolean;
    usage_id?: string;
    error?: string;
    status?: string;
    existing?: boolean;
  } | null;

  if (reservation.error || !reserved?.ok || !reserved.usage_id) {
    return { ok: false, code: "metering_unavailable" };
  }
  if (!reserved.allowed) {
    return { ok: false, code: reserved.error === "quota_exceeded" ? "quota_exceeded" : "metering_unavailable" };
  }
  // A repeated business/request key must not silently call the provider twice.
  // Reserved rows require reconciliation; completed rows already consumed provider cost.
  if (reserved.existing) return { ok: false, code: "duplicate_request" };

  const usageId = reserved.usage_id;
  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: request.instructions,
        input: request.input,
        max_output_tokens: Math.min(Math.max(request.maxOutputTokens ?? 1200, 64), 8000),
        reasoning: { effort: request.taskType === "business_analysis" ? "medium" : "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: request.schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
            strict: true,
            schema: request.schema,
          },
        },
        safety_identifier: request.actorId ?? request.businessId,
        metadata: {
          task_type: request.taskType,
          source: request.source,
          business_id: request.businessId,
          ...(request.metadata ?? {}),
        },
      }),
    });
  } catch {
    await finalizeUsage({ businessId: request.businessId, usageId, status: "failed", errorCode: "network_error" });
    return { ok: false, code: "provider_error" };
  }

  if (!providerResponse.ok) {
    await finalizeUsage({
      businessId: request.businessId,
      usageId,
      status: "failed",
      errorCode: `openai_http_${providerResponse.status}`,
    });
    return { ok: false, code: "provider_error" };
  }

  let payload: OpenAiResponse;
  try {
    payload = await providerResponse.json() as OpenAiResponse;
  } catch {
    await finalizeUsage({ businessId: request.businessId, usageId, status: "failed", errorCode: "invalid_json" });
    return { ok: false, code: "invalid_provider_response" };
  }

  const inputTokens = safeInteger(payload.usage?.input_tokens);
  const cachedInputTokens = safeInteger(payload.usage?.input_tokens_details?.cached_tokens);
  const outputTokens = safeInteger(payload.usage?.output_tokens);
  const costUsdMicros = calculateAiCostMicros(model, { inputTokens, cachedInputTokens, outputTokens });
  const text = responseText(payload);

  if (payload.status !== "completed" || !text) {
    await finalizeUsage({
      businessId: request.businessId,
      usageId,
      status: "failed",
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costUsdMicros,
      errorCode: payload.status === "incomplete" ? "incomplete" : "missing_output",
    });
    return { ok: false, code: "invalid_provider_response" };
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    await finalizeUsage({
      businessId: request.businessId,
      usageId,
      status: "failed",
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costUsdMicros,
      errorCode: "structured_output_parse_failed",
    });
    return { ok: false, code: "invalid_provider_response" };
  }

  await finalizeUsage({
    businessId: request.businessId,
    usageId,
    status: "completed",
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsdMicros,
  });

  return {
    ok: true,
    data,
    usage: {
      requestId,
      usageId,
      model,
      credits,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costUsdMicros,
    },
  };
}
