import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chatActor, checked, loadRoom } from "@/lib/chat/store";
import { attachmentBytes } from "@/lib/chat/media";
import { ChatError, uuid } from "@/lib/chat/validation";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isDatabaseMode()) throw new ChatError("unavailable", "Archivo no disponible.", 404);
    const db: any = createSupabaseAdminClient(), actor = await chatActor(db, await getCurrentUserContext());
    const id = uuid((await context.params).id);
    const file = checked(await db.from("chat_attachments").select("*").eq("id", id).eq("business_id", actor.businessId).eq("ready", true).maybeSingle());
    if (!file) throw new ChatError("not_found", "Archivo no disponible.", 404);
    const { membership } = await loadRoom(db, actor, file.room_id);
    const message = checked(await db.from("chat_messages").select("id").eq("attachment_id", id).eq("room_id", file.room_id).eq("business_id", actor.businessId).gte("created_at", membership.joined_at).maybeSingle());
    if (!message) throw new ChatError("not_found", "Archivo no disponible.", 404);
    const bytes = await attachmentBytes(db, file);
    const headers: Record<string, string> = { "Content-Type": file.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Accept-Ranges": "bytes",
      "Content-Disposition": `${file.mime === "application/pdf" || request.nextUrl.searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/'/g, "%27")}` };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = Number(match?.[1]), end = match?.[2] ? Number(match[2]) : bytes.length - 1;
      if (!match || start > end || start >= bytes.length || end >= bytes.length) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
      return new NextResponse(new Blob([new Uint8Array(bytes.slice(start, end + 1))]).stream(), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    }
    // Streaming avoids the platform's buffered response limit for 20 MB attachments.
    return new NextResponse(new Blob([new Uint8Array(bytes)]).stream(), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ChatError ? error.message : "No pudimos abrir el archivo." }, { status: error instanceof ChatError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
