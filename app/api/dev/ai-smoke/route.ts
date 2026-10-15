import { NextResponse } from "next/server";
import { runManagedAi } from "@/lib/ai/gateway";

const QA_BUSINESS_ID = "290cea71-508e-44a9-b0a3-5730d8201ca6";
const QA_REQUEST_ID = "d94bd712-4e45-4ffc-bdb7-9bd851830f15";

export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const result = await runManagedAi<{ ok: boolean; message: string }>({
    businessId: QA_BUSINESS_ID,
    actorId: null,
    requestId: QA_REQUEST_ID,
    taskType: "tool_interpretation",
    source: "system",
    instructions: "This is a fixed deployment smoke test. Return JSON only, with ok=true and message='gateway-ready'.",
    input: "Verify the managed AI gateway runtime.",
    schemaName: "managed_ai_smoke",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        message: { type: "string", enum: ["gateway-ready"] },
      },
      required: ["ok", "message"],
    },
    metadata: { qa: "managed-openai-smoke" },
    maxOutputTokens: 64,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, code: result.code }, { status: 503 });
  }

  return NextResponse.json({
    ok: result.data.ok === true && result.data.message === "gateway-ready",
    model: result.usage.model,
    credits: result.usage.credits,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsdMicros: result.usage.costUsdMicros,
  });
}
