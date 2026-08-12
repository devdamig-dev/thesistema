"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (active) setChecking(false);
        return;
      }
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      setAuthorized(!error && Boolean(data.user));
      setChecking(false);
    }

    void verifySession();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      toast({
        tone: "warn",
        title: "Contraseña demasiado corta",
        description: "Usá al menos 8 caracteres.",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        tone: "warn",
        title: "Las contraseñas no coinciden",
        description: "Escribí la misma contraseña en ambos campos.",
      });
      return;
    }

    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast({
          tone: "warn",
          title: "No pudimos guardar la contraseña",
          description: error.message,
        });
        return;
      }

      toast({
        tone: "success",
        title: "Contraseña actualizada",
        description: "Tu nueva contraseña ya está activa.",
      });
      router.replace("/");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg-elevated p-6 shadow-soft md:p-8">
        <div className="mb-6">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-black text-white">
            G
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Elegí una contraseña nueva
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            La vas a usar junto con tu email para ingresar a GastroPilot.
          </p>
        </div>

        {checking ? (
          <div className="rounded-xl border border-line bg-bg-subtle p-4 text-sm text-ink-muted">
            Validando el enlace de recuperación…
          </div>
        ) : authorized ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label="Nueva contraseña"
              value={password}
              onChange={setPassword}
            />
            <PasswordField
              label="Repetir contraseña"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={saving || !password || !confirmPassword}
            >
              {saving ? "Guardando…" : "Guardar nueva contraseña"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-warn-500/30 bg-warn-500/10 p-4 text-sm text-warn-300">
              El enlace no generó una sesión válida o ya venció. Pedí uno nuevo desde el ingreso.
            </div>
            <Link href="/login?recovery=1" className="block">
              <Button variant="secondary" size="lg" className="w-full">
                Pedir otro enlace
              </Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2 focus-within:border-line-strong focus-within:ring-2 focus-within:ring-brand-500/20">
        <KeyRound className="h-4 w-4 text-ink-subtle" />
        <input
          type="password"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
        />
      </div>
    </div>
  );
}
