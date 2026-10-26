"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, FileText, MessageCircle, Plus, Settings2, Sparkles, Users, WifiOff } from "lucide-react";
import type { ChatSnapshot } from "@/lib/chat/types";
import { mergeMessages, mergeSnapshot } from "@/lib/chat/client-state";
import { Composer } from "./composer";
import { RoomEditor } from "./room-editor";
import { MobileTools } from "./mobile-tools";
import { chatRequest } from "./api";

const time = (date: string) => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(date));
const day = (date: string) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(date));
export function ChatClient({ initial }: { initial: ChatSnapshot }) {
  const [data, setData] = useState(initial), [selected, setSelected] = useState(initial.room?.id ?? "");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [online, setOnline] = useState(true);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null), [actionBusy, setActionBusy] = useState(false), [historyBusy, setHistoryBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [mobileHeight, setMobileHeight] = useState<number>();
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const selectedRef = useRef(selected), requestVersion = useRef(0), bottom = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), stick = useRef(true);
  const inFlight = useRef<{ room: string; version: number } | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    const resize = () => setMobileHeight(window.innerWidth < 768 ? Math.max(220, (window.visualViewport?.height ?? window.innerHeight) - 56) : undefined);
    resize(); window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  const refresh = useCallback(async (roomId: string, quiet = false) => {
    if (quiet && inFlight.current?.room === roomId) return;
    const version = ++requestVersion.current;
    inFlight.current = { room: roomId, version };
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/chat${roomId ? `?room=${encodeURIComponent(roomId)}` : ""}`, { cache: "no-store" });
      const result = await response.json();
      if (version !== requestVersion.current || selectedRef.current !== roomId) return;
      if (!response.ok || !result.ok) {
        if ([401, 403, 404].includes(response.status)) { setData(previous => ({ ...previous, room: undefined, messages: [], pendingId: null })); setSelected(""); }
        throw new Error(result.error || "No pudimos actualizar el chat.");
      }
      setData(previous => mergeSnapshot(previous, result.data));
      setError("");
    } catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : "Se interrumpió la conexión. Reintentaremos al volver."); }
    finally { if (inFlight.current?.version === version) inFlight.current = null; if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    changed(); window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, []);
  useEffect(() => {
    if (!online) return;
    void refresh(selected);
    const poll = () => { setClock(Date.now()); if (document.visibilityState === "visible") void refresh(selected, true); };
    const timer = window.setInterval(poll, 4000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [selected, online, refresh]);
  const messages = data.room?.id === selected ? data.messages ?? [] : [];
  const last = messages.at(-1);
  const lastId = last?.id;
  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: "end" }); }, [last?.id, last?.ai_status]);
  useEffect(() => {
    if (!selected || !lastId || document.visibilityState !== "visible" || !online) return;
    void chatRequest({ action: "read", roomId: selected }).catch(() => {});
  }, [selected, lastId, online]);
  function openRoom(id: string) {
    setSelected(id); selectedRef.current = id; stick.current = true; setPrefill(undefined); setError("");
    setData(previous => ({ ...previous, room: undefined, messages: [], pendingId: null, pendingKind: null }));
    window.history.replaceState(null, "", id ? `/chat?room=${encodeURIComponent(id)}` : "/chat");
  }
  async function older() {
    if (!selected || !messages[0] || historyBusy) return;
    const room = selected; setHistoryBusy(true);
    const height = viewport.current?.scrollHeight ?? 0;
    try {
      const cursor = `${messages[0].created_at}|${messages[0].id}`;
      const response = await fetch(`/api/chat?room=${encodeURIComponent(room)}&before=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No pudimos cargar el historial.");
      if (selectedRef.current !== room) return;
      stick.current = false;
      setData(previous => ({ ...previous, messages: mergeMessages(result.data.messages, previous.messages ?? []), hasOlder: result.data.hasOlder }));
      requestAnimationFrame(() => { if (viewport.current) viewport.current.scrollTop += viewport.current.scrollHeight - height; });
    } catch (e) { setError(e instanceof Error ? e.message : "No pudimos cargar el historial."); }
    finally { setHistoryBusy(false); }
  }
  async function act(body: Record<string, unknown>) {
    if (actionBusy) return;
    setActionBusy(true); setError("");
    const room = selected;
    try { await chatRequest({ ...body, roomId: room }); await refresh(room, true); }
    catch (e) { setError(e instanceof Error ? e.message : "No pudimos confirmar la acción."); }
    finally { setActionBusy(false); }
  }
  const room = data.room?.id === selected ? data.room : undefined;
  const busyAi = !!room?.agent_busy_until && Date.parse(room.agent_busy_until) > clock;
  return <section style={mobileHeight ? { height: mobileHeight } : undefined} className="relative flex h-[calc(100dvh-56px)] min-h-0 overflow-hidden bg-bg" aria-label="Chat del equipo">
    <aside className={`${selected ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-line bg-bg-subtle/50 md:w-64 xl:w-72`}>
      <div className="border-b border-line p-4"><div className="flex items-center justify-between"><div><h1 className="text-lg font-semibold">Chat del equipo</h1><p className="mt-1 text-xs text-ink-muted">Tu negocio, en conversación</p></div>{data.me.admin ? <button aria-label="Crear grupo" onClick={() => setEditor("new")} className="rounded-xl bg-brand-500/15 p-2 text-brand-300 hover:bg-brand-500/25"><Plus className="h-5 w-5" /></button> : null}</div></div>
      <nav aria-label="Grupos del negocio" className="flex-1 space-y-1 overflow-y-auto p-2">{data.rooms.map(r => <button key={r.id} onClick={() => openRoom(r.id)} aria-current={r.id === selected ? "page" : undefined} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${r.id === selected ? "bg-brand-500/10 ring-1 ring-inset ring-brand-500/25" : "hover:bg-bg-elevated"}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-300"><Users className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{r.name}</span><span className="mt-0.5 block truncate text-xs text-ink-subtle">{data.branches.find(b => b.id === r.branch_id)?.name ?? "Sucursal"}</span></span></button>)}{!data.rooms.length ? <div className="p-4 text-sm leading-relaxed text-ink-muted">{data.me.admin ? "Creá un grupo y elegí a las personas que van a trabajar juntas." : "Tu administrador puede sumarte a un grupo del negocio."}</div> : null}</nav>
      <div className="px-4 pb-3 text-xs leading-relaxed text-ink-subtle">WhatsApp sigue disponible para los chats individuales autorizados. <Link href="/ajustes/whatsapp" className="text-brand-300 underline">Ver conexión</Link></div><MobileTools />
    </aside>
    <div className={`${selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
      {selected ? <><header className="flex min-h-20 shrink-0 items-center gap-3 border-b border-line px-3 py-3 md:px-5"><button onClick={() => openRoom("")} className="rounded-lg p-2 md:hidden" aria-label="Volver a grupos"><ArrowLeft className="h-5 w-5" /></button><span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-300 sm:grid"><Users className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{room?.name ?? "Cargando grupo…"}</h2><p className="mt-1 truncate text-xs text-ink-muted">{room ? `${data.participants?.length ?? 0} integrantes · ${data.branches.find(b => b.id === room.branch_id)?.name ?? "Sucursal"}` : "Verificando acceso"}</p></div>{data.me.admin && room ? <button aria-label="Configurar integrantes" onClick={() => setEditor("edit")} className="rounded-xl border border-line p-2.5 text-ink-muted hover:bg-bg-elevated"><Settings2 className="h-4 w-4" /></button> : null}</header>
        {!online ? <div role="status" className="flex items-center gap-2 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"><WifiOff className="h-4 w-4" />Sin conexión. El envío se habilita al volver.</div> : null}
        {error ? <div role="alert" className="flex items-center justify-between gap-2 border-b border-red-400/20 bg-red-400/10 px-4 py-2 text-sm text-red-200"><span>{error}</span><button onClick={() => refresh(selected)} className="shrink-0 underline">Actualizar</button></div> : null}
        <div ref={viewport} onScroll={() => { const v = viewport.current; if (v) stick.current = v.scrollHeight - v.scrollTop - v.clientHeight < 120; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-6" aria-label="Mensajes del grupo">
          {data.hasOlder && messages.length ? <button onClick={older} disabled={historyBusy} className="mx-auto mb-4 block rounded-full border border-line px-4 py-2 text-xs text-ink-muted">{historyBusy ? "Cargando…" : "Cargar mensajes anteriores"}</button> : null}
          {!messages.length ? <div className="mx-auto max-w-sm py-10 text-center"><MessageCircle className="mx-auto mb-3 h-10 w-10 text-brand-400/60" /><p className="text-sm font-medium">{loading ? "Abriendo conversación…" : "Este espacio es del equipo"}</p><p className="mt-2 text-sm leading-relaxed text-ink-muted">Compartí mensajes, audios, fotos y documentos. Activá «Pedir ayuda a la IA» cuando quieras consultar o preparar una carga.</p></div> : null}
          {messages.map((message, index) => {
            const own = message.member_id === data.me.id;
            const showDay = !index || day(messages[index - 1].created_at) !== day(message.created_at);
            const pending = own && data.pendingId === message.pending_id;
            const fileUrl = message.attachment ? `/api/chat/files/${message.attachment.id}` : "";
            return <div key={message.id}>{showDay ? <div className="my-4 text-center"><span className="rounded-full border border-line bg-bg-subtle px-3 py-1 text-[11px] text-ink-muted">{day(message.created_at)}</span></div> : null}<article aria-label={`Mensaje de ${message.author_name}`} className={`mb-4 max-w-[92%] sm:max-w-[82%] ${own ? "ml-auto" : "mr-auto"}`}>
              <div className={`rounded-2xl border px-3.5 py-3 ${own ? "rounded-br-md border-brand-500/20 bg-brand-500/10" : "rounded-bl-md border-line bg-bg-elevated/50"}`}><div className="mb-1.5 flex items-center justify-between gap-4"><span className={`text-xs font-semibold ${own ? "text-brand-300" : "text-ink-muted"}`}>{own ? "Vos" : message.author_name}</span><span className="flex items-center gap-1 text-[10px] text-ink-subtle"><time dateTime={message.created_at}>{time(message.created_at)}</time>{own ? <Check className="h-3 w-3" aria-label="Guardado" /> : null}</span></div>
                {message.attachment ? <div className="mb-2">{message.attachment.mime.startsWith("audio/") ? <audio controls preload="none" src={fileUrl} className="max-w-full" aria-label={`Audio de ${message.author_name}`} /> : message.attachment.mime.startsWith("image/") ? <a href={`${fileUrl}?download=1`} target="_blank" rel="noreferrer">{/* Private images require the authenticated endpoint. */}<img src={fileUrl} loading="lazy" alt={message.attachment.filename} className="max-h-64 max-w-full rounded-lg object-contain" /></a> : null}<a href={`${fileUrl}?download=1`} className="mt-2 flex items-center gap-2 text-xs text-brand-300 underline"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{message.attachment.filename}</span></a></div> : null}
                {message.body ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p> : null}
                {message.ask_ai ? <span className="mt-2 flex items-center gap-1 text-[10px] text-ai-300"><Sparkles className="h-3 w-3" />Solicitud a la IA</span> : null}
              </div>
              {message.ask_ai ? <div className="mt-2 rounded-2xl border border-ai-400/20 bg-ai-500/[0.06] px-3.5 py-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ai-300"><Sparkles className="h-3.5 w-3.5" />GastroPilot IA</div>{message.ai_text ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">{message.ai_text}</p> : <p role="status" className="text-sm text-ink-muted">{message.ai_status === "queued" ? busyAi ? "Hay otra consulta en curso. Tu mensaje está guardado." : "Tu solicitud está guardada. Podés iniciar su procesamiento." : busyAi ? "Interpretando tu solicitud…" : "La respuesta se interrumpió. Revisá la operación pendiente antes de repetir una carga."}</p>}
                {own && message.ai_status === "queued" && !busyAi ? <button onClick={() => act({ action: "retry_ai", id: message.id })} disabled={actionBusy || !online} className="mt-3 rounded-lg border border-ai-400/30 px-3 py-2 text-xs text-ai-300 disabled:opacity-40">Procesar con IA</button> : null}
                {pending && data.pendingKind === "confirmation" && message.ai_status === "done" && !!data.pendingExpiresAt && Date.parse(data.pendingExpiresAt) > clock ? <div className="mt-3 flex flex-wrap gap-2"><button disabled={actionBusy || busyAi || !online} onClick={() => act({ action: "send", id: crypto.randomUUID(), body: "confirmar", askAi: true, pendingId: data.pendingId })} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Confirmar operación</button><button disabled={actionBusy || busyAi || !online} onClick={() => act({ action: "send", id: crypto.randomUUID(), body: "cancelar", askAi: true, pendingId: data.pendingId })} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-40">Cancelar</button></div> : null}
                {own && message.attachment && message.ai_result === "completed" && message.ai_text ? <button onClick={() => setPrefill({ text: `Quiero preparar una carga con estos datos. Pedime lo que falte:\n${message.ai_text?.replace(/^Contenido interpretado del adjunto:\n\n/, "").split("\n\nRevisá estos datos.")[0]}`, nonce: Date.now() })} className="mt-3 rounded-lg border border-ai-400/30 px-3 py-2 text-xs text-ai-300">Usar este texto para preparar una carga</button> : null}
              </div> : null}
            </article></div>;
          })}<div ref={bottom} />
        </div>
        {data.pendingId && data.pendingKind === "confirmation" && (!data.pendingExpiresAt || Date.parse(data.pendingExpiresAt) <= clock || !messages.some(m => m.pending_id === data.pendingId && m.ai_status === "done")) ? <details className="max-h-48 overflow-y-auto border-t border-line px-4 py-3 text-xs"><summary className="cursor-pointer text-ai-300">Revisar operación pendiente</summary><p className="my-3 whitespace-pre-wrap text-ink-muted">{data.pendingSummary}</p>{data.pendingExpiresAt && Date.parse(data.pendingExpiresAt) > clock ? <button disabled={actionBusy || busyAi || !online} onClick={() => act({ action: "send", id: crypto.randomUUID(), body: "confirmar", askAi: true, pendingId: data.pendingId })} className="mr-3 rounded-lg bg-brand-500 px-3 py-2 text-white disabled:opacity-40">Confirmar operación</button> : null}<button disabled={actionBusy || busyAi || !online} onClick={() => act({ action: "send", id: crypto.randomUUID(), body: "cancelar", askAi: true, pendingId: data.pendingId })} className="rounded-lg border border-line px-3 py-2 disabled:opacity-40">Cerrar pedido pendiente</button></details> : null}
        {data.pendingId ? <div className="flex items-center gap-2 border-t border-ai-400/20 bg-ai-500/5 px-4 py-2 text-xs text-ai-300"><Sparkles className="h-3.5 w-3.5 shrink-0" /><span>{data.pendingKind === "clarification" ? "La IA necesita más datos. Respondé con «Pedir ayuda a la IA» activado." : "Tenés una operación pendiente. Revisá el resumen antes de confirmar."}</span><button aria-label="Ir al último mensaje" className="ml-auto" onClick={() => { stick.current = true; bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }}><ChevronDown className="h-4 w-4" /></button></div> : null}
        {room ? <Composer key={selected} roomId={selected} userId={data.me.userId} online={online} pendingId={data.pendingId} prefill={prefill} onSent={() => { stick.current = true; setPrefill(undefined); void refresh(selected, true); }} /> : null}
      </> : <div className="m-auto max-w-md p-8 text-center"><div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl border border-brand-500/20 bg-brand-500/10"><MessageCircle className="h-9 w-9 text-brand-300" /></div><h2 className="text-2xl font-semibold">Un lugar para trabajar juntos</h2><p className="mt-3 text-sm leading-relaxed text-ink-muted">Conversaciones del equipo, documentos y asistencia de IA, con el historial de tu negocio a mano desde el celular.</p>{data.me.admin ? <button onClick={() => setEditor("new")} className="mt-6 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white">Crear un grupo</button> : null}</div>}
    </div>
    {editor ? <RoomEditor data={data} editing={editor === "edit"} onClose={() => setEditor(null)} onSaved={id => { setEditor(null); openRoom(id); }} /> : null}
  </section>;
}
