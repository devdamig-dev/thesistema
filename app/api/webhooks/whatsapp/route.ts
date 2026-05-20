/**
 * Webhook WhatsApp Cloud API · stub.
 *
 * Esta ruta queda preparada para recibir mensajes desde Meta. En
 * Sprint 1 sólo:
 *   - Devuelve 200 con el challenge en GET (verificación de Meta).
 *   - En POST guarda el mensaje en `whatsapp_messages` y crea una
 *     `ai_extraction` placeholder con confidence = 0 (la integración
 *     con Claude/GPT va en Sprint 2).
 *
 * Variables de entorno:
 *   META_VERIFY_TOKEN — token compartido con Meta para verificar el
 *                       endpoint cuando se registra el webhook.
 *
 * Para producción real falta:
 *   - Validar la firma X-Hub-Signature-256.
 *   - Resolver el business_id desde el número receptor.
 *   - Disparar la edge function que llama al LLM.
 *   - Manejar audios/imágenes (subir a Storage y referenciar).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";

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
    // En modo demo no escribimos en DB, sólo devolvemos OK.
    return NextResponse.json({ ok: true, persisted: false, mode: "demo" });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const db = supabase as any;

    // Resolver business — en sprint próximo, mapear por número receptor.
    // Por ahora, tomamos el primer business del workspace activo.
    const bizRes = await db.from("businesses").select("id").limit(1).maybeSingle();
    const biz = bizRes.data as { id: string } | null;
    if (!biz) {
      return NextResponse.json(
        { ok: false, reason: "no_business" },
        { status: 404 },
      );
    }

    // Cloud API empaqueta los mensajes así:
    //   entry[].changes[].value.messages[]
    // Para sprint 1 aceptamos un payload simplificado:
    //   { from: "Mateo", role: "Socio", channel: "text", text: "..." }
    const incoming = normalizeIncoming(body);

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
        { ok: false, reason: msgRes.error?.message ?? "insert_failed" },
        { status: 500 },
      );
    }

    // Extracción placeholder. La IA real entra en Sprint 2.
    await db.from("ai_extractions").insert({
      message_id: msg.id,
      type: "unknown",
      fields: {},
      confidence: 0,
      status: "pending",
    });

    return NextResponse.json({ ok: true, message_id: msg.id, persisted: true });
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
  // Forma simplificada que usamos en sprint 1.
  if (typeof payload?.text === "string") {
    return {
      sender_name: payload.from ?? "Sin nombre",
      sender_role: payload.role ?? "Equipo",
      channel: payload.channel ?? "text",
      raw: payload.text,
    };
  }
  // Forma Cloud API real (la implementamos completa en sprint 2).
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
