/**
 * Webhook WhatsApp Cloud API · Sprint 2.
 *
 * Flujo:
 *   1. Verifica firma/token (GET).
 *   2. Recibe POST con payload simplificado o Cloud API.
 *   3. Inserta el mensaje en `whatsapp_messages`.
 *   4. Llama a la IA (`extractFromMessage`) para extraer campos.
 *   5. Inserta el resultado en `ai_extractions` con estado pending /
 *      needs_review / failed según confidence y fuente.
 *   6. Devuelve 200 con `message_id` y `extraction_id`.
 *
 * En modo demo, devolvemos 200 sin persistir para que tests con curl
 * sigan funcionando.
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

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "gastropilot-dev";

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
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }

  if (!isDatabaseMode()) {
    // Modo demo: corremos la extracción para que el caller pueda ver
    // lo que la IA detectó, pero no persistimos.
    const incoming = normalizeIncoming(body);
    const extraction = await extractFromMessage(incoming.raw, incoming.sender_name);
    return NextResponse.json({
      ok: true,
      persisted: false,
      mode: "demo",
      extraction,
    });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const db = supabase as any;

    // En sprint próximo: mapear business_id por número receptor de Meta.
    // Por ahora tomamos el primer business (mono-tenant inicial).
    const bizRes = await db.from("businesses").select("id").limit(1).maybeSingle();
    const biz = bizRes.data as { id: string } | null;
    if (!biz) {
      return NextResponse.json({ ok: false, reason: "no_business" }, { status: 404 });
    }

    const incoming = normalizeIncoming(body);

    // 1) Persistir el mensaje
    const msgRes = await db
      .from("whatsapp_messages")
      .insert({
        business_id: biz.id,
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
      return NextResponse.json(
        { ok: false, reason: msgRes.error?.message ?? "insert_message_failed" },
        { status: 500 },
      );
    }

    // 2) Extraer con IA
    const extraction = await extractFromMessage(incoming.raw, incoming.sender_name);

    // 3) Estado inicial según confidence y fuente
    const status =
      extraction.source === "failed" || extraction.confidence < 0.4
        ? "failed"
        : extraction.missing_fields.length > 0 || extraction.confidence < 0.7
          ? "needs_review"
          : "pending";

    // 4) Persistir extracción
    const extractionRes = await db
      .from("ai_extractions")
      .insert({
        message_id: msg.id,
        business_id: biz.id,
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

    return NextResponse.json({
      ok: true,
      persisted: true,
      message_id: msg.id,
      extraction_id: extractionRow?.id,
      extraction,
      status,
    });
  } catch (error: any) {
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
} {
  // Payload simplificado (para curl/test).
  if (typeof payload?.text === "string") {
    return {
      sender_name: payload.from ?? "Sin nombre",
      sender_role: payload.role ?? "Equipo",
      channel: payload.channel ?? "text",
      raw: payload.text,
    };
  }
  // Cloud API real (parseo parcial — completar en sprint próximo).
  const change = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  const contact = change?.contacts?.[0];
  return {
    sender_name: contact?.profile?.name ?? "WhatsApp",
    sender_role: "Equipo",
    channel: (message?.type as any) ?? "text",
    raw: message?.text?.body ?? "[mensaje no textual]",
  };
}
