/**
 * Webhook WhatsApp Cloud API · Sprint 2.
 *
 * Flujo:
 *   1. Verifica firma/token (GET).
 *   2. Recibe POST con payload simplificado o Cloud API.
 *   3. Resuelve el negocio por el número receptor configurado.
 *   4. Inserta el mensaje en `whatsapp_messages`.
 *   5. Llama a la IA (`extractFromMessage`) para extraer campos.
 *   6. Inserta el resultado en `ai_extractions` con estado pending /
 *      needs_review / failed según confidence y fuente.
 *   7. Devuelve 200 con `message_id` y `extraction_id`.
 *
 * En modo demo, devolvemos 200 sin persistir para que tests con curl
 * sigan funcionando.
 *
 * IMPORTANTE: en database mode nunca elegimos "el primer negocio".
 * Un mensaje sólo se persiste si el número receptor coincide de forma
 * unívoca con un business que tenga WhatsApp marcado como conectado.
 *
 * Variables de entorno:
 *   META_VERIFY_TOKEN    — token compartido para Meta (default: gastropilot-dev).
 *   ANTHROPIC_API_KEY    — opcional. Si no está, usamos el heurístico.
 *   ANTHROPIC_MODEL_ID   — opcional. Default: claude-haiku-4-5-20251001.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { extractFromMessage } from "@/lib/ai/extract";
import { createNotification } from "@/lib/data/notifications";
import { logActivity } from "@/lib/data/activity";
import { rateLimit } from "@/lib/rate-limit";

async function logSystemEvent(
  businessId: string | null,
  action: string,
  summary: string,
  data?: Record<string, unknown>,
) {
  if (!isDatabaseMode() || !businessId) return;
  try {
    await logActivity({
      businessId,
      actorName: "Sistema",
      actorRole: "system",
      action,
      targetType: action.split(".")[0],
      summary,
      data,
    });
  } catch {
    // best-effort: nunca atribuir un evento a otro negocio sólo para loguearlo.
  }
}

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "gastropilot-dev";

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

async function resolveBusinessByRecipient(
  db: any,
  recipientPhone: string | null,
): Promise<
  | { ok: true; businessId: string }
  | { ok: false; reason: "recipient_not_identified" | "whatsapp_not_configured" | "ambiguous_recipient" }
> {
  const recipient = normalizePhone(recipientPhone);
  if (!recipient) return { ok: false, reason: "recipient_not_identified" };

  const res = await db
    .from("businesses")
    .select("id, whatsapp_phone")
    .eq("whatsapp_connected", true)
    .not("whatsapp_phone", "is", null);

  if (res.error) throw res.error;

  const matches = ((res.data ?? []) as { id: string; whatsapp_phone: string | null }[]).filter(
    (business) => normalizePhone(business.whatsapp_phone) === recipient,
  );

  if (matches.length === 0) return { ok: false, reason: "whatsapp_not_configured" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous_recipient" };
  return { ok: true, businessId: matches[0].id };
}

// ---------- GET — verificación inicial de Meta ----------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, reason: "invalid_verify_token" }, { status: 403 });
}

// ---------- POST — recibe mensajes ----------
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`webhook:${ip}`, { windowMs: 60_000, max: 60 });
  if (!rl.ok) {
    // Antes de parsear el payload no conocemos el tenant. No inventamos uno.
    return NextResponse.json(
      { ok: false, reason: "rate_limited", remaining: rl.remaining },
      { status: 429 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    // Un JSON inválido tampoco permite atribuir el evento a un negocio de forma segura.
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  const incoming = normalizeIncoming(body);

  if (!isDatabaseMode()) {
    const extraction = await extractFromMessage(incoming.raw, incoming.sender_name);
    return NextResponse.json({
      ok: true,
      persisted: false,
      mode: "demo",
      extraction,
    });
  }

  let businessId: string | null = null;
  try {
    const supabase = createSupabaseAdminClient();
    const db = supabase as any;

    const resolved = await resolveBusinessByRecipient(db, incoming.recipient_phone);
    if (!resolved.ok) {
      const status = resolved.reason === "ambiguous_recipient" ? 409 : 422;
      return NextResponse.json({ ok: false, reason: resolved.reason }, { status });
    }
    businessId = resolved.businessId;

    // 1) Persistir el mensaje en el tenant resuelto.
    const msgRes = await db
      .from("whatsapp_messages")
      .insert({
        business_id: businessId,
        sender_name: incoming.sender_name,
        sender_role: incoming.sender_role,
        channel: incoming.channel,
        raw: incoming.raw,
        preview: incoming.raw.slice(0, 120),
        received_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    const msg = msgRes.data as { id: string } | null;
    if (!msg) {
      await logSystemEvent(businessId, "webhook.error", "No se pudo persistir el mensaje de WhatsApp", {
        error: msgRes.error?.message ?? "insert_message_failed",
      });
      return NextResponse.json(
        { ok: false, reason: msgRes.error?.message ?? "insert_message_failed" },
        { status: 500 },
      );
    }

    // 2) Extraer con IA.
    const extraction = await extractFromMessage(incoming.raw, incoming.sender_name);

    // 3) Estado inicial según confidence y fuente.
    const status =
      extraction.source === "failed" || extraction.confidence < 0.4
        ? "failed"
        : extraction.missing_fields.length > 0 || extraction.confidence < 0.7
          ? "needs_review"
          : "pending";

    // 4) Persistir extracción en el mismo tenant.
    const extractionRes = await db
      .from("ai_extractions")
      .insert({
        message_id: msg.id,
        business_id: businessId,
        type: extraction.movement_type,
        fields: extraction.detected_fields,
        missing: extraction.missing_fields,
        confidence: extraction.confidence,
        status,
        source: extraction.source,
        summary: extraction.normalized_summary,
        target_entity: extraction.target_entity,
      })
      .select("id")
      .maybeSingle();
    const extractionRow = extractionRes.data as { id: string } | null;

    await createNotification({
      businessId,
      tone:
        status === "failed"
          ? "danger"
          : status === "needs_review"
            ? "warn"
            : "ai",
      title:
        status === "failed"
          ? "Nuevo mensaje IA · no entendí"
          : status === "needs_review"
            ? "Movimiento IA · necesita revisión"
            : "Nuevo movimiento IA · listo para aprobar",
      detail: extraction.normalized_summary ?? incoming.raw.slice(0, 80),
      href: "/inbox",
      source: "inbox",
    });

    return NextResponse.json({
      ok: true,
      persisted: true,
      message_id: msg.id,
      extraction_id: extractionRow?.id,
      extraction,
      status,
    });
  } catch (error: any) {
    await logSystemEvent(
      businessId,
      "webhook.error",
      `Webhook WhatsApp falló · ${error?.message ?? "unknown_error"}`,
      { error: error?.message ?? "unknown_error" },
    );
    return NextResponse.json(
      { ok: false, reason: error?.message ?? "unknown_error" },
      { status: 500 },
    );
  }
}

function normalizeIncoming(payload: any): {
  sender_name: string;
  sender_role: string;
  channel: "text" | "audio" | "image" | "document";
  raw: string;
  recipient_phone: string | null;
} {
  // Payload simplificado para curl/test. En database mode debe incluir `to`
  // (o `recipient` / `business_phone`) para poder resolver el tenant.
  if (typeof payload?.text === "string") {
    return {
      sender_name: payload.from ?? "Sin nombre",
      sender_role: payload.role ?? "Equipo",
      channel: payload.channel ?? "text",
      raw: payload.text,
      recipient_phone: payload.to ?? payload.recipient ?? payload.business_phone ?? null,
    };
  }

  // Cloud API real: Meta incluye el número receptor en value.metadata.display_phone_number.
  const change = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  const contact = change?.contacts?.[0];
  return {
    sender_name: contact?.profile?.name ?? "WhatsApp",
    sender_role: "Equipo",
    channel: (message?.type as any) ?? "text",
    raw: message?.text?.body ?? "[mensaje no textual]",
    recipient_phone: change?.metadata?.display_phone_number ?? null,
  };
}
