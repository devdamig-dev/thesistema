"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type SessionInfo = {
  wabaId: string | null;
  phoneNumberId: string | null;
};

export function WhatsappEmbeddedSignup({
  appId,
  configId,
  graphVersion,
}: {
  appId: string | null;
  configId: string | null;
  graphVersion: string;
}) {
  const { toast } = useToast();
  const [sdkReady, setSdkReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sessionInfo = useRef<SessionInfo>({ wabaId: null, phoneNumberId: null });
  const configured = Boolean(appId && configId);

  useEffect(() => {
    if (!configured || !appId) return;

    const onMessage = (event: MessageEvent) => {
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
      const payload = data?.data ?? {};
      if (data?.event === "FINISH" || data?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
        sessionInfo.current = {
          wabaId: payload.waba_id ?? payload.wabaId ?? null,
          phoneNumberId: payload.phone_number_id ?? payload.phoneNumberId ?? null,
        };
      }
    };

    window.addEventListener("message", onMessage);

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: graphVersion,
      });
      setSdkReady(true);
    };

    if (window.FB) {
      window.fbAsyncInit();
    } else if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/es_LA/sdk.js";
      document.body.appendChild(script);
    }

    return () => window.removeEventListener("message", onMessage);
  }, [appId, configured, graphVersion]);

  const connect = () => {
    if (!window.FB || !configId) {
      toast({ tone: "warn", title: "La conexión todavía no está disponible" });
      return;
    }

    sessionInfo.current = { wabaId: null, phoneNumberId: null };
    window.FB.login(
      async (response) => {
        const code = response.authResponse?.code;
        const { wabaId, phoneNumberId } = sessionInfo.current;
        if (!code) return;
        if (!wabaId || !phoneNumberId) {
          toast({
            tone: "warn",
            title: "Meta no devolvió todos los datos de la cuenta",
            description: "Volvé a iniciar la conexión y completá todos los pasos.",
          });
          return;
        }

        setSubmitting(true);
        try {
          const result = await fetch("/api/integrations/whatsapp/embedded-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, wabaId, phoneNumberId }),
          });
          const payload = await result.json().catch(() => ({}));
          if (!result.ok || !payload?.ok) {
            throw new Error(payload?.message || "No pudimos completar la conexión");
          }
          toast({ tone: "success", title: "WhatsApp Business conectado" });
          window.location.reload();
        } catch (error: any) {
          toast({
            tone: "danger",
            title: "No pudimos completar la conexión",
            description: error?.message || "Intentá nuevamente.",
          });
        } finally {
          setSubmitting(false);
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
        },
      },
    );
  };

  if (!configured) {
    return (
      <div className="rounded-xl border border-warn-500/25 bg-warn-500/[0.05] p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-warn-500/30 bg-warn-500/10">
            <MessageSquareText className="h-5 w-5 text-warn-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Conexión pendiente de habilitación</div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
              La cuenta de Meta del producto todavía debe quedar habilitada antes de vincular el número del negocio. Cuando esa configuración esté lista, vas a poder iniciar la conexión desde esta misma pantalla.
            </p>
            <Button variant="ghost" size="sm" className="mt-3" disabled>
              Conectar WhatsApp Business
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.05] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Vinculá tu cuenta de WhatsApp Business</div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
            Iniciá el alta oficial de Meta para elegir la cuenta y el número que querés usar con GastroPilot.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={connect} disabled={!sdkReady || submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
          {submitting ? "Conectando…" : sdkReady ? "Conectar WhatsApp" : "Preparando conexión…"}
        </Button>
      </div>
    </div>
  );
}
