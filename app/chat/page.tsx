import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chatActor, snapshot } from "@/lib/chat/store";
import { ChatError, uuid } from "@/lib/chat/validation";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const context = await getCurrentUserContext();
  if (!context.isAuthenticated && isDatabaseMode()) redirect("/login?next=%2Fchat");
  let data;
  let message = "";
  try {
    if (!isDatabaseMode()) throw new ChatError("demo", "El chat de equipo está disponible al ingresar con tu cuenta real.");
    const db = createSupabaseAdminClient(), actor = await chatActor(db, context);
    const room = (await searchParams).room;
    data = await snapshot(db, actor, room ? uuid(room) : undefined);

  } catch (error) {
    message = error instanceof ChatError ? error.message : "No pudimos cargar el chat. Probá actualizar la página.";
  }
  if (data) return <ChatClient initial={data} />;
  return <section className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Chat del equipo</h1><p className="my-4 text-ink-muted">{message}</p><div className="flex gap-5"><Link className="text-brand-300 underline" href="/chat">Volver a abrir</Link><Link className="text-ink-muted underline" href="/ajustes/whatsapp">WhatsApp</Link></div></section>;
}
