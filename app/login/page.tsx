"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        toast({
          tone: "ai",
          title: "Modo demo activo",
          description: "Login real disponible cuando se conecte Supabase.",
        });
        router.push(next);
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined" ? `${window.location.origin}${next}` : undefined,
        },
      });
      if (error) {
        toast({ tone: "warn", title: "No pudimos enviar el link", description: error.message });
      } else {
        toast({
          tone: "success",
          title: "Te mandamos un link a tu mail",
          description: "Abrilo desde el dispositivo donde querés iniciar sesión.",
        });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="relative grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Panel izquierdo - branding */}
      <div className="relative hidden overflow-hidden border-r border-line bg-bg-subtle/60 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-ai-500/15 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft">
              <span className="text-lg font-black text-white">G</span>
            </div>
            <div className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink">
              GastroPilot
              <span className="rounded-md bg-ai-500/15 px-1.5 py-0.5 text-[10px] font-bold text-ai-400">
                AI
              </span>
            </div>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink">
            Tu negocio, ordenado desde WhatsApp.
          </h1>
          <p className="mt-3 max-w-md text-sm text-ink-muted leading-relaxed">
            Cada mensaje, foto o audio se convierte en un registro útil. La IA
            entiende tus ventas, compras, gastos, stock y empleados, y te muestra
            lo que antes no veías.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink-muted">
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-ai-400" />
              Inbox IA · WhatsApp como fuente
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-ai-400" />
              OCR de facturas y cierres diarios
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-ai-400" />
              Marketing IA · campañas listas para enviar
            </li>
          </ul>
        </div>

        <div className="relative text-[11px] text-ink-subtle">
          © {new Date().getFullYear()} GastroPilot AI · Hecho en Buenos Aires
        </div>
      </div>

      {/* Panel derecho - login */}
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft">
                <span className="text-base font-black text-white">G</span>
              </div>
              <div className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-ink">
                GastroPilot
                <span className="rounded-md bg-ai-500/15 px-1.5 py-0.5 text-[10px] font-bold text-ai-400">
                  AI
                </span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              Entrá a GastroPilot
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Te mandamos un link mágico a tu correo. Sin contraseñas.
            </p>
          </div>

          <form onSubmit={handleMagicLink} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-muted">
                Email
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-brand-500/20">
                <Mail className="h-4 w-4 text-ink-subtle" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mateo@labirra.com"
                  className="h-7 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
                />
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={sending || !email}
            >
              {sending ? "Enviando…" : "Enviar link mágico"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
              <span className="bg-bg px-2 text-ink-subtle">o</span>
            </div>
          </div>

          <Link href={next}>
            <Button variant="ghost" size="lg" className="w-full">
              <Zap className="h-4 w-4 text-ai-400" />
              Entrar como demo
            </Button>
          </Link>

          {isDemoMode() && (
            <div className="rounded-xl border border-ai-400/25 bg-ai-500/[0.06] p-3 text-xs text-ai-400">
              <div className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="h-3 w-3" />
                Modo demo activo
              </div>
              <p className="mt-1 text-ink-muted">
                La app está corriendo con datos de ejemplo. Para activar Supabase
                cambiá <code className="rounded bg-bg-elevated px-1 py-0.5 text-[10px]">NEXT_PUBLIC_APP_MODE=database</code>.
              </p>
            </div>
          )}

          <p className="text-center text-[11px] text-ink-subtle">
            ¿Necesitás ayuda?{" "}
            <Link href="/ayuda" className="text-brand-300 hover:text-brand-200">
              Centro de ayuda
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
