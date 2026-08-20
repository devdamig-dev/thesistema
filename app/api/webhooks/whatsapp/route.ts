/**
 * Webhook WhatsApp Cloud API.
 *
 * En producción:
 *   - GET valida META_VERIFY_TOKEN para el alta del webhook.
 *   - POST valida x-hub-signature-256 con META_APP_SECRET antes de parsear.
 *   - El tenant se resuelve únicamente por el número receptor conectado.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
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

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const providedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const provided = Buffer.from(providedHex, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
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
  const verifyToken = process.env.META_VERIFY_TOKEN?.trim() || (!isDatabaseMode() ? "gastropilot-dev" : null);
  if (!verifyToken) {
    return NextResponse.json({ ok: false, reason: "webhook_not_configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, reason: "invalid_verify_token" }, { status: 403 });
}

// ---------- POST — recibe mensajes ----------
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`webhook:${ip}`, { windowMs: 60_000, max: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", remaining: rl.remaining },
      { status: 429 },
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  if (isDatabaseMode()) {
    if (!process.env.META_APP_SECRET?.trim()) {
      return NextResponse.json({ ok: false, reason: "webhook_not_configured" }, { status: 503 });
    }
    if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
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

    const extraction = await extractFromMessage(incoming.raw, incoming.sender_name);
    const status =
      extraction.source === "failed" || extraction.confidence < 0.4
        ? "failed"
        : extraction.missing_fields.length > 0 || extraction.confidence < 0.7
          ? "needs_review"
          : "pending";

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
  if (typeof payload?.text === "string") {
    return {
      sender_name: payload.from ?? "Sin nombre",
      sender_role: payload.role ?? "Equipo",
      channel: payload.channel ?? "text",
      raw: payload.text,
      recipient_phone: payload.to ?? payload.recipient ?? payload.business_phone ?? null,
    };
  }

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
