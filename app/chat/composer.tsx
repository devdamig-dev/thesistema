"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Square, X, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fileDescriptor } from "@/lib/chat/validation";
import { chatRequest } from "./api";

type SendDraft = { id: string; body: string; attachmentId: string | null; askAi: boolean; pendingId: string | null };
export function Composer({ roomId, userId, online, pendingId, prefill, onSent }: { roomId: string; userId: string; online: boolean; pendingId?: string | null; prefill?: { text: string; nonce: number }; onSent(): void }) {
  const key = `gp-chat-draft-v1:${userId}:${roomId}`;
  const [body, setBody] = useState(""), [file, setFile] = useState<File | null>(null), [askAi, setAskAi] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState<SendDraft | null>(null);
  const [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0);
  const [audioPreview, setAudioPreview] = useState("");
  const input = useRef<HTMLInputElement>(null), textarea = useRef<HTMLTextAreaElement>(null), recorder = useRef<MediaRecorder | null>(null), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    try { const saved = sessionStorage.getItem(key); if (saved) { const draft = JSON.parse(saved); if (typeof draft.id === "string" && typeof draft.body === "string") { setRetry(draft); setBody(draft.body); setAskAi(draft.askAi); setError("Quedó un envío sin confirmar. Reintentá para comprobarlo sin duplicarlo."); } } } catch { /* Storage may be disabled. */ }
    return () => { alive.current = false; recorder.current?.stream.getTracks().forEach(track => track.stop()); if (recorder.current?.state === "recording") recorder.current.stop(); };
  }, [key]);
  useEffect(() => { if (prefill && !retry) { setBody(prefill.text.slice(0, 10000)); setAskAi(true); textarea.current?.focus(); } }, [prefill, retry]);
  useEffect(() => {
    if (!file?.type.startsWith("audio/")) { setAudioPreview(""); return; }
    const url = URL.createObjectURL(file); setAudioPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000);
    const stop = window.setTimeout(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, 120000);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); };
  }, [recording]);
  function choose(file: File | undefined) {
    if (!file) return;
    try { fileDescriptor({ filename: file.name, mime: file.type, size: file.size }); setFile(file); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Archivo no compatible."); }
  }
  async function record() {
    setError("");
    if (recording) { recorder.current?.stop(); return; }
    try {
      if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) throw new Error("Este navegador no permite grabar. Podés adjuntar un audio desde el clip.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: Blob[] = [];
      recorder.current = media; media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        if (!alive.current) return;
        setRecording(false);
        const type = media.mimeType.split(";")[0];
        choose(new File(chunks, `Audio-${Date.now()}.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`, { type }));
      };
      media.onerror = () => { stream.getTracks().forEach(track => track.stop()); if (alive.current) { setRecording(false); setError("Se interrumpió la grabación. Podés intentarlo de nuevo."); } };
      setSeconds(0); setRecording(true); media.start();
    } catch (e) { setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Permití el micrófono para grabar un audio."); }
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault(); if (busy || recording || !online || !retry && !body.trim() && !file) return;
    setBusy(true); setError("");
    try {
      let draft = retry;
      if (!draft) {
        let attachmentId: string | null = null;
        if (file) {
          const descriptor = fileDescriptor({ filename: file.name, mime: file.type, size: file.size });
          const upload = await chatRequest({ action: "upload_prepare", roomId, ...descriptor });
          const db = createSupabaseBrowserClient();
          if (!db) throw new Error("Ingresá nuevamente para adjuntar el archivo.");
          const result = await db.storage.from("team-chat").uploadToSignedUrl(upload.path, upload.token, file, { contentType: descriptor.mime });
          if (result.error) throw new Error("El archivo no terminó de subir. Reintentá con conexión estable.");
          await chatRequest({ action: "upload_complete", roomId, id: upload.id }); attachmentId = upload.id;
        }
        draft = { id: crypto.randomUUID(), body: body.trim(), attachmentId, askAi, pendingId: askAi && /^(s[ií]|confirmo|dale|ok|confirmar|no|cancelar|cancel[aá]|cancelo|no confirmar)[.!\s]*$/i.test(body.trim()) ? pendingId ?? null : null };
        setRetry(draft); try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* In-memory retry remains available. */ }
      }
      await chatRequest({ action: "send", roomId, ...draft });
      try { sessionStorage.removeItem(key); } catch { /* No persisted draft. */ }
      if (alive.current) { setBody(""); setFile(null); setRetry(null); if (input.current) input.current.value = ""; onSent(); textarea.current?.focus(); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "El envío no se confirmó. Reintentá sin duplicarlo."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <form onSubmit={send} className="shrink-0 border-t border-line bg-bg-subtle p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
    {file ? <div className="mb-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs"><Paperclip className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" disabled={busy || !!retry} aria-label="Quitar adjunto" onClick={() => setFile(null)}><X className="h-4 w-4" /></button></div> : null}
    {audioPreview ? <audio controls src={audioPreview} aria-label="Escuchar audio antes de enviar" className="mb-2 max-w-full" /> : null}
    {recording ? <p role="status" className="mb-2 text-sm text-red-300">● Grabando {seconds}s / 120s. Tocá detener para revisar y enviar.</p> : null}
    {error ? <p role="alert" className="mb-2 text-sm text-red-300">{error}</p> : null}
    <div className="flex items-end gap-2"><div className="flex gap-1"><input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav" className="hidden" aria-label="Adjuntar archivo" onChange={e => choose(e.target.files?.[0])} /><button type="button" aria-label="Adjuntar foto, PDF o audio" disabled={busy || recording || !!retry} onClick={() => input.current?.click()} className="rounded-xl p-2.5 text-ink-muted hover:bg-bg-elevated disabled:opacity-40"><Paperclip className="h-5 w-5" /></button><button type="button" aria-label={recording ? "Detener grabación" : "Grabar audio"} disabled={busy || !!retry} onClick={record} className={`rounded-xl p-2.5 disabled:opacity-40 ${recording ? "bg-red-500/20 text-red-300" : "text-ink-muted hover:bg-bg-elevated"}`}>{recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button></div>
      <textarea ref={textarea} aria-label="Mensaje al grupo" placeholder={askAi ? "Pedile a la IA una consulta o carga…" : "Escribí al equipo…"} rows={2} maxLength={10000} value={body} disabled={busy || !!retry} onChange={e => setBody(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(); } }} className="max-h-36 min-w-0 flex-1 resize-y rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-brand-500 disabled:opacity-60" />
      <button type="submit" aria-label={retry ? "Reintentar envío" : "Enviar mensaje"} disabled={busy || recording || !online || !retry && !body.trim() && !file} className="rounded-xl bg-brand-500 p-3 text-white disabled:opacity-40"><Send className="h-5 w-5" /></button>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><label className="flex cursor-pointer items-center gap-2 text-ai-300"><input type="checkbox" checked={askAi} disabled={busy || !!retry} onChange={e => setAskAi(e.target.checked)} className="h-4 w-4 accent-violet-500" /><Sparkles className="h-3.5 w-3.5" />Pedir ayuda a la IA</label><span role="status" className="text-ink-subtle">{busy ? "Enviando…" : retry ? "Envío por verificar · reintentá" : askAi ? "Las cargas requieren tu confirmación" : "Mensaje para el equipo"}</span></div>
  </form>;
}
