import { runManagedAi } from "./gateway";
import type { PendingOperation, ToolCall, ToolDefinition } from "@/lib/whatsapp-agent/types";

type IntentResult = {
  matched: boolean;
  tool: string;
  arguments_json: string;
};

export async function interpretWithManagedAi(args: {
  businessId: string;
  actorId: string;
  text: string;
  tools: ToolDefinition[];
  pending?: PendingOperation | null;
}): Promise<ToolCall | null> {
  if (!args.text.trim() || args.tools.length === 0) return null;

  const allowedNames = args.tools.map((tool) => tool.name);
  const toolCatalog = args.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    required: tool.required,
    risk: tool.risk,
  }));

  const result = await runManagedAi<IntentResult>({
    businessId: args.businessId,
    actorId: args.actorId,
    taskType: "tool_interpretation",
    source: "whatsapp",
    schemaName: "whatsapp_tool_intent",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matched: { type: "boolean" },
        tool: { type: "string", enum: ["none", ...allowedNames] },
        arguments_json: { type: "string" },
      },
      required: ["matched", "tool", "arguments_json"],
    },
    instructions: [
      "Interpretá un mensaje de WhatsApp para un sistema de gestión empresarial.",
      "Tu única tarea es seleccionar una operación del catálogo autorizado y extraer argumentos explícitos.",
      "Nunca ejecutes operaciones, nunca inventes IDs, montos, fechas, unidades, sucursales ni datos que no estén en el mensaje.",
      "Si la intención no es inequívoca, devolvé matched=false, tool=none y arguments_json={}.",
      "arguments_json debe ser un objeto JSON serializado. No incluyas requestId, expectedVersion, business_id, actor_id ni otros campos internos.",
      "Las operaciones sensibles serán validadas y confirmadas por el backend después de tu interpretación.",
      `Catálogo autorizado: ${JSON.stringify(toolCatalog)}`,
      args.pending
        ? `Hay una operación pendiente del backend: ${args.pending.toolCall.name}. Usala sólo como contexto de intención; no copies identificadores internos.`
        : "No hay una operación pendiente.",
    ].join("\n"),
    input: args.text,
    metadata: { capability_count: String(args.tools.length) },
    maxOutputTokens: 700,
  });

  if (!result.ok || !result.data.matched || result.data.tool === "none") return null;
  if (!allowedNames.includes(result.data.tool)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.data.arguments_json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const forbidden = ["requestId", "expectedVersion", "business_id", "businessId", "actor_id", "actorId", "created_by"];
  if (forbidden.some((key) => Object.hasOwn(parsed as object, key))) return null;

  return {
    name: result.data.tool,
    arguments: parsed as Record<string, unknown>,
  };
}
