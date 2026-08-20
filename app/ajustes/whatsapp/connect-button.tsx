"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";

type FbLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FbApi = {
  init: (options: Record<string, unknown>) => void;
  login: (
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FbApi;
  }
}

type Props = {
  appId: string | null;
  configId: string | null;
  apiVersion: string;
};

export function WhatsAppConnectButton({ appId, configId, apiVersion }: Props) {
  const router = useRouter();
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const signupData = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const completing = useRef(false);

  const configured = Boolean(appId && configId);

  async function completeIfReady() {
    const { code, wabaId, phoneNumberId } = signupData.current;
    if (!code || !wabaId || !phoneNumberId || completing.current) return;

    completing.current = true;
    setBusy(true);
    setStatus("Confirmando la conexión con Meta…");

    try {
      const response = await fetch("/api/integrations/whatsapp/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "No pudimos completar la conexión.");
      }

      setStatus("WhatsApp Business quedó conectado.");
      router.refresh();
    } catch (error) {
      completing.current = false;
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "No pudimos completar la conexión.");
    }
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;

      let data: any = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;

      if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
        signupData.current.wabaId = data.data?.waba_id ?? data.data?.wabaId;
        signupData.current.phoneNumberId = data.data?.phone_number_id ?? data.data?.phoneNumberId;
        void completeIfReady();
      }

      if (data.event === "CANCEL") {
        setBusy(false);
        setStatus("La conexión fue cancelada antes de finalizar.");
      }

      if (data.event === "ERROR") {
        setBusy(false);
        setStatus("Meta informó un error durante la conexión. Podés volver a intentarlo.");
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function initializeSdk() {
    if (!configured || !window.FB) return;
    window.FB.init({
      appId,
      autoLogAppEvents: true,
      xfbml: true,
      version: apiVersion,
    });
    setSdkReady(true);
  }

  function launchSignup() {
    if (!configured || !sdkReady || !window.FB || !configId || busy) return;

    signupData.current = {};
    completing.current = false;
    setBusy(true);
    setStatus("Abrimos Meta para vincular tu número…");

    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setBusy(false);
          setStatus("No se recibió autorización de Meta. Podés volver a intentarlo.");
          return;
        }
        signupData.current.code = code;
        void completeIfReady();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {configured ? (
        <Script
          src="https://connect.facebook.net/es_LA/sdk.js"
          strategy="afterInteractive"
          onLoad={initializeSdk}
        />
      ) : null}

      <Button
        variant="primary"
        size="sm"
        disabled={!configured || !sdkReady || busy}
        onClick={launchSignup}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
        {busy ? "Conectando…" : "Conectar WhatsApp Business"}
      </Button>

      {!configured ? (
        <p className="max-w-xl text-xs leading-relaxed text-warn-400">
          La conexión está preparada, pero falta habilitar la aplicación de Meta para este entorno.
        </p>
      ) : null}

      {status ? <p className="max-w-xl text-xs leading-relaxed text-ink-muted">{status}</p> : null}
    </div>
  );
}
