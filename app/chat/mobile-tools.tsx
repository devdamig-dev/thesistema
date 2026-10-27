"use client";
import { useEffect, useState } from "react";
import { Bell, Download } from "lucide-react";
import { chatRequest } from "./api";

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export function MobileTools() {
  const [install, setInstall] = useState<InstallEvent | null>(null), [status, setStatus] = useState("");
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    const onInstall = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    let alive = true;
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async registration => {
      if (alive && "PushManager" in window) setEnabled(Boolean(await registration.pushManager.getSubscription()));
    }).catch(() => {});
    return () => { alive = false; window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);
  async function installApp() {
    if (!install) { setStatus("En iPhone: Compartir → Añadir a pantalla de inicio. En Android: menú del navegador → Instalar app o Añadir a pantalla de inicio."); return; }
    await install.prompt(); await install.userChoice; setInstall(null);
  }
  async function notifications() {
    setBusy(true); setStatus("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("Para recibir avisos en iPhone, instalá GastroPilot en la pantalla de inicio y abrilo desde su ícono.");
      // Permission must follow the button directly, including on installed iOS apps.
      if (!enabled && await Notification.requestPermission() !== "granted") throw new Error("Las notificaciones no están habilitadas. Podés cambiar el permiso en los ajustes del navegador.");
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (enabled && current) { await chatRequest({ action: "unsubscribe", endpoint: current.endpoint }); await current.unsubscribe(); setEnabled(false); setStatus("Notificaciones desactivadas en este dispositivo."); return; }
      const { publicKey } = await chatRequest({ action: "push_key" });
      const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), c => c.charCodeAt(0));
      const subscription = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await chatRequest({ action: "subscribe", subscription: subscription.toJSON() }); setEnabled(true); setStatus("Recibirás avisos de nuevos mensajes. El contenido queda dentro de la app.");
    } catch (e) { setStatus(e instanceof Error ? e.message : "No pudimos activar las notificaciones."); }
    finally { setBusy(false); }
  }
  return <div className="border-t border-line p-3"><div className="flex gap-2"><button onClick={installApp} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-2 py-2.5 text-xs hover:bg-bg-elevated"><Download className="h-4 w-4" />Instalar app</button><button onClick={notifications} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-2 py-2.5 text-xs hover:bg-bg-elevated disabled:opacity-50"><Bell className="h-4 w-4" />{busy ? "Esperá…" : enabled ? "Desactivar avisos" : "Activar avisos"}</button></div>{status ? <p role="status" className="mt-2 text-xs leading-relaxed text-ink-muted">{status}</p> : null}</div>;
}
