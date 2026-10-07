/** Official Meta transport. Account + phone IDs resolve the tenant; no display-phone guesses. */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { extractFromMessage } from "@/lib/ai/extract";
import { logActivity } from "@/lib/data/activity";
import { processWhatsAppAgentMessage } from "@/lib/whatsapp-agent/service";
import { resolveAuthorizedConversation } from "@/lib/whatsapp-agent/supabase-adapter";
import { sendMetaTextReply } from "@/lib/whatsapp-agent/meta-transport";
import { incomingMetaTexts, validMetaSignature } from "@/lib/whatsapp/webhook";
import { record } from "@/lib/whatsapp/signup";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const verifyToken = process.env.META_VERIFY_TOKEN?.trim() || (!isDatabaseMode() ? "gastropilot-dev" : null);
  if (!verifyToken) return NextResponse.json({ ok: false, reason: "webhook_not_configured" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken && params.get("hub.challenge")) return new NextResponse(params.get("hub.challenge"), { status: 200 });
  return NextResponse.json({ ok: false, reason: "invalid_verify_token" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ ok: false }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); return NextResponse.json({ ok: false, reason: "payload_too_large" }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } catch { return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 }); }
  if (isDatabaseMode()) {
    const secret = process.env.META_APP_SECRET?.trim();
    if (!secret) return NextResponse.json({ ok: false, reason: "webhook_not_configured" }, { status: 503 });
    if (!validMetaSignature(raw, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 }); }
  if (!isDatabaseMode()) {
    const demo = record(payload);
    const text = typeof demo.text === "string" ? demo.text : incomingMetaTexts(payload)[0]?.text;
    if (!text) return NextResponse.json({ ok: true, persisted: false, mode: "demo", ignored: true });
    const extraction = await extractFromMessage(text, typeof demo.from === "string" ? demo.from : "WhatsApp");
    return NextResponse.json({ ok: true, persisted: false, mode: "demo", extraction });
  }

  // History, SMB app sync, sent-message echoes, delivery receipts and unsupported media are ACKed, not executed.
  const messages = incomingMetaTexts(payload);
  if (!messages.length) return NextResponse.json({ ok: true, ignored: true });
  let processed = 0;
  let ignored = 0;
  let duplicates = 0;
  let failed = 0;
  const db = createSupabaseAdminClient() as any;
  for (const message of messages) {
    let businessId: string | null = null;
    try {
      const result = await db.from("whatsapp_integrations")
        .select("business_id,display_phone_number,connected_at,token_expires_at")
        .eq("phone_number_id", message.phoneNumberId).eq("waba_id", message.accountId).eq("status", "connected").maybeSingle();
      if (result.error) throw new Error("integration_lookup_failed");
      const integration = result.data;
      if (!integration || !integration.display_phone_number) { ignored += 1; continue; }
      businessId = integration.business_id;
      const connectedAt = Date.parse(integration.connected_at);
      if (!Number.isFinite(connectedAt) || message.sentAt < connectedAt - 1000 || message.sentAt > Date.now() + 300000) { ignored += 1; continue; }
      if (integration.token_expires_at && Date.parse(integration.token_expires_at) <= Date.now()) throw new Error("integration_authorization_expired");
      const input = { messageId: message.messageId, senderPhone: message.senderPhone, recipientPhone: integration.display_phone_number as string, senderName: message.senderName, text: message.text, provider: "meta" as const, providerConversationId: message.senderPhone, conversationType: "direct" as const };
      const conversation = await resolveAuthorizedConversation(db, input, integration.business_id);
      if (!conversation) { ignored += 1; continue; }
      const reply = await processWhatsAppAgentMessage(input);
      if (reply.status === "ignored" || reply.status === "rejected") {
        // Never send denied/unknown actors into the old Inbox extraction fallback.
        ignored += 1; continue;
      }
      if (reply.status === "duplicate") { duplicates += 1; continue; }
      // Core claims provider_message_id atomically before any operation. A Meta retry cannot create a second operation or Inbox copy.
      const saved = await db.from("whatsapp_messages").insert({ business_id: integration.business_id, sender_name: message.senderName, sender_role: "Equipo", channel: "text", raw: message.text, preview: message.text.slice(0, 120), received_at: new Date(message.sentAt).toISOString() });
      if (saved.error) await logActivity({ businessId: integration.business_id, actorRole: "system", action: "whatsapp.message_log_failed", summary: "No se pudo guardar la copia del mensaje; la auditoría del agente conserva el resultado", data: { message_id: message.messageId } });
      if (reply.text.trim()) {
        try { await sendMetaTextReply(integration.business_id, message.senderPhone, reply.text); }
        catch {
          await logActivity({ businessId: integration.business_id, actorRole: "system", action: "whatsapp.reply_failed", summary: "Meta no aceptó la respuesta. No se reejecutará la operación automáticamente", data: { message_id: message.messageId } });
        }
      }
      processed += 1;
    } catch {
      failed += 1;
      if (businessId) await logActivity({ businessId, actorRole: "system", action: "whatsapp.transport_failed", summary: "No se pudo procesar un mensaje autorizado de WhatsApp", data: { message_id: message.messageId } });
    }
  }
  // Retry transient read/storage failures. Agent Core's durable claim prevents replaying completed writes.
  return NextResponse.json({ ok: failed === 0, processed, ignored, duplicates, failed }, { status: failed ? 500 : 200 });
}
