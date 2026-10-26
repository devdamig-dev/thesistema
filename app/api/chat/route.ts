import { after, NextRequest, NextResponse } from "next/server";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/whatsapp/signup";
import { chatActor, snapshot } from "@/lib/chat/store";
import { ChatError, uuid } from "@/lib/chat/validation";
import { manageChat } from "@/lib/chat/manage";
import { processChatAi } from "@/lib/chat/agent";
import { notifyRoom } from "@/lib/chat/push";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
async function context() {
  if (!isDatabaseMode()) throw new ChatError("demo_mode", "El chat de equipo requiere una cuenta real.", 409);
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated) throw new ChatError("unauthenticated", "Ingresá a tu cuenta para continuar.", 401);
  const db = createSupabaseAdminClient();
  const actor = await chatActor(db, ctx);
  return { db, actor };
}
function failure(error: unknown) {
  if (error instanceof ChatError) return json({ ok: false, code: error.code, error: error.message }, error.status);
  return json({ ok: false, code: "chat_unavailable", error: "No pudimos confirmar la acción. Actualizá el chat antes de repetirla." }, 503);
}
export async function GET(request: NextRequest) {
  try {
    const { db, actor } = await context();
    const room = request.nextUrl.searchParams.get("room");
    return json({ ok: true, data: await snapshot(db, actor, room ? uuid(room) : undefined, request.nextUrl.searchParams.get("before") ?? undefined) });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request.url, request.headers.get("origin"))) throw new ChatError("invalid_origin", "La acción debe iniciarse desde GastroPilot.", 403);
    if (Number(request.headers.get("content-length")) > 24000) throw new ChatError("request_too_large", "La solicitud es demasiado extensa.", 413);
    const { db, actor } = await context();
    if (!rateLimit(`chat:${actor.businessId}:${actor.userId}`, { windowMs: 60000, max: 90 }).ok) throw new ChatError("rate_limited", "Esperá un minuto antes de continuar.", 429);
    const raw = await request.text();
    if (raw.length > 24000) throw new ChatError("request_too_large", "La solicitud es demasiado extensa.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ChatError("invalid_request", "La solicitud no es válida."); }
    const result = await manageChat(db, actor, body);
    if ("notify" in result && result.notify && result.roomId) after(async () => { try { await notifyRoom(db, actor, result.roomId); } catch { /* Delivery never changes a saved message. */ } });
    // Return the persisted message immediately. Polling observes the separate AI result.
    if ("askAi" in result && result.askAi && result.id && result.roomId) after(async () => { try { await processChatAi(db, actor, result.roomId, result.id); } catch { /* A lost outcome stays visible; never repeat a write automatically. */ } });
    return json({ ok: true, ...result });
  } catch (error) { return failure(error); }
}
