import { persistSignupDiagnostic } from "@/lib/whatsapp/signup-diagnostic-store";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeConnectionActor, ConnectionError, parseConnectionRequest, sameOrigin } from "@/lib/whatsapp/signup";
import { WhatsAppGraph } from "@/lib/whatsapp/graph";
import { prepareConnection, connectSelection } from "@/lib/whatsapp/connection-service";
import { CONNECTION_SESSION_TABLE, connectionStore } from "@/lib/whatsapp/connection-store";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest) {
  try {
    if (!isDatabaseMode()) throw new ConnectionError("demo_mode", "La demostración no conecta números reales.");
    if (!sameOrigin(request.url, request.headers.get("origin"))) throw new ConnectionError("invalid_origin", "La conexión debe iniciarse desde Thesistema.", 403);
    const actor = authorizeConnectionActor(await getCurrentUserContext());
    const limit = rateLimit(`whatsapp-connect:${actor.userId}:${actor.businessId}`, { windowMs: 60_000, max: 12 });
    if (!limit.ok) throw new ConnectionError("rate_limited", "Esperá un minuto antes de volver a intentar la conexión.", 429);
    const db = createSupabaseAdminClient() as any;
    const profile = await db.from("profiles").select("active").eq("id", actor.userId).maybeSingle();
    if (profile.error || profile.data?.active !== true) throw new ConnectionError("permission_denied", "No pudimos confirmar tus permisos para conectar WhatsApp.", 403);
    const raw = await request.text();
    if (raw.length > 16384) throw new ConnectionError("request_too_large", "La solicitud es demasiado grande.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ConnectionError("invalid_request", "La solicitud de conexión no es válida."); }
    const input = parseConnectionRequest(body);
    if (input.action === "report_error") {
      const configId = input.mode === "business_app"
        ? process.env.NEXT_PUBLIC_META_WHATSAPP_BUSINESS_APP_CONFIG_ID?.trim() || process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID?.trim() || ""
        : process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID?.trim() || "";
      return json(await persistSignupDiagnostic(db, actor, input, { appId: process.env.META_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim() || "", configId }));
    }
    const store = connectionStore(db);
    if (input.action === "cancel") {
      const result = await db.from(CONNECTION_SESSION_TABLE)
        .update({ consumed_at: new Date().toISOString(), access_token: null, choices: [] })
        .eq("id", input.sessionId).eq("business_id", actor.businessId).eq("user_id", actor.userId)
        .is("claimed_at", null).is("consumed_at", null).select("id").maybeSingle();
      if (result.error || !result.data) throw new ConnectionError("session_unavailable", "No se pudo cancelar: la solicitud venció o ya comenzó a procesarse. Actualizá la página para comprobar el estado.", 409);
      return json({ ok: true, phase: "cancelled" });
    }
    const appId = process.env.META_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim() || "";
    const appSecret = process.env.META_APP_SECRET?.trim() || "";
    const version = process.env.META_GRAPH_VERSION?.trim() || process.env.NEXT_PUBLIC_META_GRAPH_VERSION?.trim() || "v25.0";
    const callbackUrl = process.env.META_WEBHOOK_CALLBACK_URL?.trim()
      || new URL("/api/webhooks/whatsapp", process.env.NEXT_PUBLIC_APP_URL?.trim() || request.url).toString();
    const graph = new WhatsAppGraph({ appId, appSecret, version, callbackUrl });
    if (input.action === "prepare") return json(await prepareConnection(actor, input, graph, store));
    return json(await connectSelection(actor, input.sessionId, input.phoneNumberId, graph, store));
  } catch (error) {
    if (error instanceof ConnectionError) return json({ ok: false, code: error.code, error: error.message, recovery: error.recovery }, error.status);
    return json({ ok: false, code: "connection_failed", recovery: "check_status", error: "No pudimos completar la conexión. No borres ni desvincules tu WhatsApp; actualizá la página y volvé a intentarlo." }, 502);
  }
}

