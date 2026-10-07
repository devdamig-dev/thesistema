"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionError, parseSignupEvent, signupOptions, type PhoneChoice, type SignupMode } from "@/lib/whatsapp/signup";

import { connectionRecovery } from "@/lib/whatsapp/connection-recovery";

type FbLoginResponse = { authResponse?: { code?: string }; status?: string };
type FbApi = { init: (options: Record<string, unknown>) => void; login: (callback: (response: FbLoginResponse) => void, options: Record<string, unknown>) => void };
declare global { interface Window { FB?: FbApi } }
type Props = { appId: string | null; configId: string | null; apiVersion: string; businessAppConfigId?: string | null };
type Phase = "idle" | "authorizing" | "preparing" | "choosing" | "connecting" | "linked" | "error";

export function WhatsAppConnectButton({ appId, configId, apiVersion, businessAppConfigId }: Props) {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [mode, setMode] = useState<SignupMode>("business_app");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [choices, setChoices] = useState<PhoneChoice[]>([]);
  const [selected, setSelected] = useState("");
  const session = useRef<string | null>(null);
  const attempt = useRef(0);
  const active = useRef(false);
  const started = useRef(false);
  const payload = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const controller = useRef<AbortController | null>(null);
  const selectedConfig = mode === "business_app" ? businessAppConfigId || configId : configId;
  const configured = Boolean(appId && selectedConfig);
  const busy = ["authorizing", "preparing", "connecting"].includes(phase);
  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);

  const api = useCallback(async (body: Record<string, unknown>) => {
    controller.current = new AbortController();
    const abort = controller.current;
    const timer = setTimeout(() => abort.abort(), 60000);
    try {
      const response = await fetch("/api/integrations/whatsapp/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new ConnectionError(typeof result?.code === "string" ? result.code : "connection_failed", result?.error || "No pudimos completar la conexión. Actualizá la página para comprobar su estado.", response.status, connectionRecovery(result?.code, result?.recovery));
      return result;
    } finally { clearTimeout(timer); }
  }, []);

  const prepare = useCallback(async (generation: number) => {
    if (!active.current || generation !== attempt.current || started.current || !payload.current.code) return;
    started.current = true;
    clearTimers();
    setPhase("preparing");
    setStatus("Comprobando las cuentas y los números que autorizaste…");
    try {
      const result = await api({ action: "prepare", mode, ...payload.current });
      if (generation !== attempt.current || !active.current) return;
      session.current = result.sessionId;
      setChoices(result.choices);
      // The user always confirms the exact phone. Never silently select the first available one.
      setSelected("");
      setPhase("choosing");
      setStatus("Elegí el número que querés vincular a este negocio y confirmá la conexión.");
      active.current = false;
      payload.current = {};
    } catch (error) {
      if (generation !== attempt.current) return;
      active.current = false;
      payload.current = {};
      setPhase("error");
      setStatus(error instanceof Error && error.name !== "AbortError" ? error.message : "La verificación demoró demasiado. Volvé a iniciar la conexión.");
    }
  }, [api, clearTimers, mode]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!active.current || started.current) return;
      const value = parseSignupEvent(event.origin, event.data);
      if (!value) return;
      if (value.kind === "finish") {
        payload.current = { ...payload.current, ...(value.accountId ? { wabaId: value.accountId } : {}), ...(value.phoneNumberId ? { phoneNumberId: value.phoneNumberId } : {}) };
        void prepare(attempt.current);
      } else {
        clearTimers();
        active.current = false;
        attempt.current += 1;
        payload.current = {};
        setPhase("error");
        setStatus(value.kind === "cancel" ? "Cancelaste el proceso en Meta. Tu WhatsApp actual no fue desvinculado." : "Meta no completó la autorización. Revisá el portfolio y el acceso al número, sin borrar tu cuenta actual.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clearTimers, prepare]);

  useEffect(() => () => { clearTimers(); controller.current?.abort(); active.current = false; attempt.current += 1; }, [clearTimers]);

  const initializeSdk = useCallback(() => {
    if (!appId || !window.FB) return;
    try {
      window.FB.init({ appId, autoLogAppEvents: false, xfbml: false, version: apiVersion });
      setSdkReady(true);
    } catch { setStatus("No pudimos iniciar Meta. Recargá la página y verificá que el navegador permita la ventana de conexión."); }
  }, [appId, apiVersion]);
  useEffect(() => { initializeSdk(); }, [initializeSdk]);

  function launchSignup() {
    if (!configured || !sdkReady || !window.FB || !selectedConfig || busy) return;
    clearTimers();
    const generation = ++attempt.current;
    payload.current = {};
    session.current = null;
    active.current = true;
    started.current = false;
    setChoices([]);
    setSelected("");
    setPhase("authorizing");
    setStatus(mode === "business_app" ? "En Meta elegí conectar tu WhatsApp Business app para conservarlo en el celular." : "En Meta elegí el portfolio y la cuenta de WhatsApp que querés autorizar.");
    timers.current.push(setTimeout(() => {
      if (generation !== attempt.current || started.current) return;
      active.current = false;
      attempt.current += 1;
      payload.current = {};
      setPhase("error");
      setStatus("No recibimos la finalización de Meta. Cerrá la ventana anterior y reintentá; no se marcó ninguna conexión como terminada.");
    }, 180000));
    try {
      window.FB.login(response => {
        if (generation !== attempt.current || !active.current) return;
        const code = response.authResponse?.code;
        if (!code) {
          clearTimers(); active.current = false; payload.current = {};
          setPhase("error"); setStatus("Meta no concedió la autorización. Podés volver a intentarlo."); return;
        }
        payload.current.code = code;
        if (payload.current.wabaId) void prepare(generation);
        // Some official completion events contain only an account; others arrive after the code.
        // If no event arrives, the server resolves accounts from the actual token grants.
        else timers.current.push(setTimeout(() => void prepare(generation), 1500));
      }, signupOptions(selectedConfig, mode));
    } catch {
      clearTimers(); active.current = false; payload.current = {};
      setPhase("error"); setStatus("No se pudo abrir Meta. Permití la ventana emergente y volvé a intentarlo.");
    }
  }

  async function connect() {
    if (!session.current || !selected || busy) return;
    setPhase("connecting");
    setStatus("Verificando el número y guardando la vinculación…");
    try {
      const result = await api({ action: "connect", sessionId: session.current, phoneNumberId: selected });
      setPhase("linked"); setStatus(result.message); session.current = null; router.refresh();
    } catch (error) {
      const recovery = error instanceof ConnectionError ? error.recovery : "check_status";
      if (recovery === "retry_selection") {
        setPhase("choosing");
      } else {
        // A consumed/expired authorization cannot be retried. A timeout has an
        // unknown outcome: refresh persisted state without repeating the write.
        session.current = null;
        setChoices([]);
        setSelected("");
        setPhase("error");
        if (recovery !== "restart") router.refresh();
      }
      setStatus(error instanceof Error && error.name !== "AbortError" ? error.message : "La respuesta demoró demasiado. Actualizá la página para comprobar si la cuenta quedó vinculada antes de reintentar.");
    }
  }
  async function cancel() {
    if (phase === "connecting") return;
    const id = session.current;
    if (id) {
      try { await api({ action: "cancel", sessionId: id }); }
      catch (error) {
        if (error instanceof ConnectionError && error.code === "session_unavailable") {
          clearTimers(); controller.current?.abort(); active.current = false; attempt.current += 1;
          session.current = null; payload.current = {}; setChoices([]); setSelected(""); setPhase("error");
          setStatus("Esta autorización ya no está disponible. Revisá el estado actualizado antes de iniciar otra conexión.");
          router.refresh();
          return;
        }
        setStatus(error instanceof Error ? error.message : "No pudimos cancelar esta autorización."); return;
      }
    }
    clearTimers(); controller.current?.abort(); active.current = false; attempt.current += 1;
    session.current = null; payload.current = {}; setChoices([]); setPhase("idle");
    setStatus("Proceso cancelado. No se desvinculó ningún número.");
  }

  return (
    <div className="max-w-2xl space-y-4">
      {appId ? <Script src="https://connect.facebook.net/es_LA/sdk.js" strategy="afterInteractive" onReady={initializeSdk} onError={() => { setSdkReady(false); setStatus("No pudimos cargar Meta. Revisá tu conexión o los bloqueadores del navegador y recargá la página."); }} /> : null}
      <fieldset disabled={busy || phase === "choosing" || phase === "linked"} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-ink">¿Cómo usás este WhatsApp?</legend>
        {([ ["business_app", "Uso WhatsApp Business en el celular", "Conservá la app y autorizá la conexión oficial con Thesistema."], ["cloud_api", "Ya lo uso con una plataforma o CRM", "Autorizá una cuenta API existente, sin reemplazar automáticamente su proveedor."] ] as const).map(([value, label, detail]) => (
          <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${mode === value ? "border-brand-500/50 bg-brand-500/5" : "border-line"}`}>
            <input type="radio" name="whatsapp-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setStatus(null); setPhase("idle"); }} className="mt-1" />
            <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-xs leading-relaxed text-ink-muted">{detail}</span></span>
          </label>
        ))}
      </fieldset>
      {choices.length > 0 ? (
        <fieldset disabled={busy || phase === "linked"} className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Números compartidos por Meta</legend>
          {choices.map(phone => <label key={phone.id} className={`flex items-start gap-3 rounded-xl border p-3 ${selected === phone.id ? "border-brand-500/50" : "border-line"} ${!phone.selectable ? "opacity-70" : "cursor-pointer"}`}>
            <input type="radio" name="whatsapp-number" disabled={!phone.selectable} checked={selected === phone.id} onChange={() => setSelected(phone.id)} className="mt-1" />
            <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{phone.name} · {phone.phone}</span>{phone.reason ? <span className="mt-1 block text-xs text-warn-400">{phone.reason}</span> : null}</span>
          </label>)}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {phase === "choosing" || phase === "connecting" ? <Button variant="primary" size="sm" disabled={!selected || busy} onClick={() => void connect()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar número y vincular</Button> : phase !== "linked" ? <Button variant="primary" size="sm" disabled={!configured || !sdkReady || busy} onClick={launchSignup}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}{busy ? "Conectando…" : "Continuar con Meta"}</Button> : null}
        {phase !== "idle" && phase !== "linked" ? <Button variant="ghost" size="sm" disabled={phase === "connecting"} onClick={() => void cancel()}>Cancelar</Button> : null}
      </div>
      {!configured ? <p className="text-xs text-warn-400">Falta habilitar la conexión de Meta para este entorno. Es un ajuste de Thesistema, no de tu número.</p> : null}
      {status ? <p role="status" aria-live="polite" className="text-sm leading-relaxed text-ink-muted">{status}</p> : null}
      <details className="text-xs text-ink-muted"><summary className="cursor-pointer font-semibold">¿No aparece tu número o Meta no lo habilita?</summary><p className="mt-2 leading-relaxed">Entrá con la persona que tiene control del portfolio y de la cuenta de WhatsApp. Administrar una página o sus anuncios no siempre incluye ese acceso. La disponibilidad final depende de Meta y del estado del número. No borres la cuenta del celular ni la desconectes de otra plataforma para forzar el alta. WhatsApp personal no es el mismo producto que WhatsApp Business.</p></details>
    </div>
  );
}
