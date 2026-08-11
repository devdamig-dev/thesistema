"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, KeyRound, Mail, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";
import { useToast } from "@/components/ui/toast";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const authCode = params.get("code");
  const demoMode = isDemoMode();
  const { toast } = useToast();

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [completingLogin, setCompletingLogin] = useState(Boolean(authCode));
  const exchangedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authCode || exchangedCodeRef.current === authCode) return;
    exchangedCodeRef.current = authCode;
    let cancelled = false;

    async function completeMagicLink() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setCompletingLogin(false);
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(authCode);
      if (cancelled) return;
      if (error) {
        setCompletingLogin(false);
        toast({
          tone: "warn",
          title: "El link no pudo iniciar la sesión",
          description: "Ese link ya no es válido. Probá con tu contraseña o pedí uno nuevo.",
        });
        return;
      }
      router.replace(next);
      router.refresh();
    }

    void completeMagicLink();
    return () => {
      cancelled = true;
    };
  }, [authCode, next, router, toast]);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        toast({ tone: "warn", title: "Login no disponible", description: "Supabase no está configurado." });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({
          tone: "warn",
          title: "No pudimos iniciar sesión",
          description: "Revisá el email y la contraseña e intentá nuevamente.",
        });
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (demoMode) router.push(next);
        else toast({ tone: "warn", title: "Login no disponible", description: "Supabase no está configurado." });
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/login?next=${encodeURIComponent(next)}`
              : undefined,
        },
      });
      if (error) {
        const description = error.message.includes("after")
          ? "Esperá unos segundos antes de pedir otro link."
          : error.message;
        toast({ tone: "warn", title: "No pudimos enviar el link", description });
      } else {
        toast({
          tone: "success",
          title: "Te mandamos un link a tu mail",
          description: "Usá siempre el correo más reciente: los links anteriores dejan de ser válidos.",
        });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="relative grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-line bg-bg-subtle/60 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-ai-500/15 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft">
            <span className="text-lg font-black text-white">G</span>
          </div>
          <div className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink">
            GastroPilot
            <span className="rounded-md bg-ai-500/15 px-1.5 py-0.5 text-[10px] font-bold text-ai-400">AI</span>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink">Tu negocio, ordenado desde WhatsApp.</h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
            Cada mensaje, foto o audio se convierte en un registro útil. La IA entiende tus ventas, compras, gastos, stock y empleados.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink-muted">
            <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-ai-400" />Inbox IA · WhatsApp como fuente</li>
            <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-ai-400" />OCR de facturas y cierres diarios</li>
            <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-ai-400" />Marketing IA · campañas listas para enviar</li>
          </ul>
        </div>
        <div className="relative text-[11px] text-ink-subtle">© {new Date().getFullYear()} GastroPilot AI · Hecho en Buenos Aires</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              {completingLogin ? "Completando tu acceso…" : "Entrá a GastroPilot"}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {completingLogin
                ? "Estamos validando el link y creando tu sesión segura."
                : mode === "password"
                  ? "Ingresá con tu email y contraseña."
                  : "Te mandamos un link mágico a tu correo."}
            </p>
          </div>

          {!completingLogin && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-bg-subtle p-1">
              <button
                type="button"
                onClick={() => setMode("password")}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${mode === "password" ? "bg-bg-elevated text-ink shadow-sm" : "text-ink-muted"}`}
              >
                Contraseña
              </button>
              <button
                type="button"
                onClick={() => setMode("magic")}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${mode === "magic" ? "bg-bg-elevated text-ink shadow-sm" : "text-ink-muted"}`}
              >
                Link mágico
              </button>
            </div>
          )}

          {!completingLogin && (
            <form onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink} className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ink-muted">Email</label>
                <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-brand-500/20">
                  <Mail className="h-4 w-4 text-ink-subtle" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    className="h-7 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
                  />
                </div>
              </div>

              {mode === "password" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-ink-muted">Contraseña</label>
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-brand-500/20">
                    <KeyRound className="h-4 w-4 text-ink-subtle" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Tu contraseña"
                      className="h-7 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={sending || !email || (mode === "password" && !password)}>
                {sending ? "Procesando…" : mode === "password" ? "Ingresar" : "Enviar link mágico"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}

          {!completingLogin && demoMode && (
            <Link href={next}>
              <Button variant="ghost" size="lg" className="w-full"><Zap className="h-4 w-4 text-ai-400" />Entrar como demo</Button>
            </Link>
          )}

          {!completingLogin && (
            <p className="text-center text-[11px] text-ink-subtle">
              ¿Necesitás ayuda? <Link href="/ayuda" className="text-brand-300 hover:text-brand-200">Centro de ayuda</Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
