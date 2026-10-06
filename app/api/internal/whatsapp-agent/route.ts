import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processWhatsAppAgentMessage } from "@/lib/whatsapp-agent/service";

function validSecret(value: string | null): boolean {
  const expected = process.env.WHATSAPP_AGENT_INTERNAL_SECRET;
  if (!expected || !value) return false;
  const a = Buffer.from(value); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Harness sin Meta. Siempre requiere secreto server-side; no crea identidades ficticias. */
export async function POST(request: NextRequest) {
  if (!validSecret(request.headers.get("x-agent-secret"))) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.sender_phone || !body?.recipient_phone || !body?.text) return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  const reply = await processWhatsAppAgentMessage({ messageId: body.message_id ?? `internal:${randomUUID()}`, senderPhone: body.sender_phone, recipientPhone: body.recipient_phone, senderName: body.sender_name, text: body.text, provider: "internal", providerConversationId: body.conversation_id ?? `direct:${body.sender_phone}`, conversationType: body.conversation_type === "group" ? "group" : "direct" });
  return NextResponse.json({ ok: reply.status === "completed", reply });
}
