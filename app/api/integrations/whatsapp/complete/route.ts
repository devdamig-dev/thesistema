import { NextRequest, NextResponse } from "next/server";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/data/activity";

const ID_PATTERN = /^\d{5,30}$/;

function graphVersion() {
  const value = process.env.META_GRAPH_VERSION?.trim() || process.env.NEXT_PUBLIC_META_GRAPH_VERSION?.trim() || "v25.0";
  return /^v\d+\.\d+$/.test(value) ? value : "v25.0";
}

async function graphJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || "Meta rechazó la operación.";
    throw new Error(message);
  }
  return payload;
}

export async function POST(request: NextRequest) {
  if (!isDatabaseMode()) {
    return NextResponse.json({ ok: false, error: "La conexión real sólo está disponible en producción." }, { status: 400 });
  }

  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId) {
    return NextResponse.json({ ok: false, error: "Necesitás iniciar sesión para conectar WhatsApp." }, { status: 401 });
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Sólo un owner o admin puede conectar WhatsApp Business." }, { status: 403 });
  }

  const appId = process.env.META_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    return NextResponse.json(
      { ok: false, error: "La aplicación de Meta todavía no está habilitada para completar conexiones." },
      { status: 503 },
    );
  }

  let body: { code?: string; wabaId?: string; phoneNumberId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const wabaId = typeof body.wabaId === "string" ? body.wabaId.trim() : "";
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  if (!code || !ID_PATTERN.test(wabaId) || !ID_PATTERN.test(phoneNumberId)) {
    return NextResponse.json({ ok: false, error: "Meta no devolvió todos los datos necesarios para completar la conexión." }, { status: 400 });
  }

  try {
    const version = graphVersion();
    const tokenParams = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const tokenPayload = await graphJson(
      `https://graph.facebook.com/${version}/oauth/access_token?${tokenParams.toString()}`,
    );
    const accessToken = typeof tokenPayload?.access_token === "string" ? tokenPayload.access_token : null;
    if (!accessToken) throw new Error("Meta no devolvió un token de acceso válido.");

    const phoneList = await graphJson(
      `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const phone = Array.isArray(phoneList?.data)
      ? phoneList.data.find((item: any) => String(item?.id) === phoneNumberId)
      : null;
    if (!phone) throw new Error("El número seleccionado no pertenece a la cuenta de WhatsApp autorizada.");

    await graphJson(
      `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const displayPhone = typeof phone.display_phone_number === "string" ? phone.display_phone_number.trim() : null;
    const expiresIn = Number(tokenPayload?.expires_in);
    const tokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    const now = new Date().toISOString();

    const admin = createSupabaseAdminClient() as any;
    const integrationResult = await admin
      .from("whatsapp_integrations")
      .upsert(
        {
          business_id: ctx.businessId,
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          display_phone_number: displayPhone,
          access_token: accessToken,
          token_type: typeof tokenPayload?.token_type === "string" ? tokenPayload.token_type : null,
          token_expires_at: tokenExpiresAt,
          status: "connected",
          connected_at: now,
          updated_at: now,
        },
        { onConflict: "business_id" },
      );
    if (integrationResult.error) throw new Error("No pudimos guardar la conexión de WhatsApp.");

    const businessResult = await admin
      .from("businesses")
      .update({
        whatsapp_connected: true,
        whatsapp_phone: displayPhone,
        whatsapp_connected_at: now,
        whatsapp_waba_id: wabaId,
        whatsapp_phone_number_id: phoneNumberId,
        whatsapp_connection_status: "connected",
      })
      .eq("id", ctx.businessId);
    if (businessResult.error) throw new Error("No pudimos actualizar el estado del negocio.");

    try {
      await logActivity({
        businessId: ctx.businessId,
        actorName: ctx.fullName || ctx.email || "Usuario",
        actorRole: ctx.role,
        action: "whatsapp.connected",
        targetType: "whatsapp",
        summary: displayPhone ? `WhatsApp Business conectado · ${displayPhone}` : "WhatsApp Business conectado",
        data: { waba_id: wabaId, phone_number_id: phoneNumberId },
      });
    } catch {
      // La conexión no debe fallar si el log de auditoría no está disponible.
    }

    return NextResponse.json({ ok: true, phone: displayPhone });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "No pudimos completar la conexión con Meta." },
      { status: 502 },
    );
  }
}
