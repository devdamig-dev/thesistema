import { NextRequest, NextResponse } from "next/server";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { authorizeConnectionActor, ConnectionError, sameOrigin } from "@/lib/whatsapp/signup";
import { parseGroupRequest } from "@/lib/whatsapp/groups";
import { assertGroupAdmin } from "@/lib/whatsapp/groups-store";
import { manageGroups } from "@/lib/whatsapp/groups-management";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: NextRequest) {
  try {
    if (!isDatabaseMode()) throw new ConnectionError("demo_mode", "La demostración no crea grupos reales.");
    if (!sameOrigin(request.url, request.headers.get("origin"))) throw new ConnectionError("invalid_origin", "La configuración debe iniciarse desde GastroPilot.", 403);
    const actor = authorizeConnectionActor(await getCurrentUserContext());
    if (!rateLimit(`whatsapp-groups:${actor.businessId}:${actor.userId}`, { windowMs: 60000, max: 20 }).ok) throw new ConnectionError("rate_limited", "Esperá un minuto antes de continuar.", 429);
    const db = createSupabaseAdminClient();
    await assertGroupAdmin(db, actor);
    const raw = await request.text();
    if (raw.length > 20000) throw new ConnectionError("request_too_large", "La solicitud es demasiado extensa.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ConnectionError("invalid_request", "La solicitud no es válida."); }
    return json(await manageGroups(db, actor, parseGroupRequest(body)));
  } catch (error) {
    if (error instanceof ConnectionError) return json({ ok: false, code: error.code, error: error.message }, error.status);
    return json({ ok: false, code: "group_operation_failed", error: "No pudimos confirmar la operación. Actualizá el estado antes de repetirla." }, 503);
  }
}
