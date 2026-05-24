"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChefHat,
  CreditCard,
  Loader2,
  MapPin,
  MessageSquareText,
  Rocket,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { STEPS, SALE_CHANNELS, BRANCH_TYPES, type OnboardingStep } from "@/lib/onboarding/types";
import { INDUSTRIES } from "@/lib/industries";
import type { Industry } from "@/lib/entities";
import {
  saveBusinessStep,
  saveBranchStep,
  saveChannelsStep,
  saveTeamStep,
  saveWhatsappStep,
  seedIngredientsAndProducts,
  completeOnboarding,
} from "@/app/actions/onboarding";
import { cn } from "@/lib/utils";

const STEP_ICONS = [Building2, MapPin, CreditCard, UserPlus, MessageSquareText, ChefHat, Rocket];

export default function OnboardingClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [currentStep, setCurrentStep] = useState(0);

  // Form data (todas en uno para simplicidad del wizard)
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState<Industry>("hamburgueseria");
  const [branchName, setBranchName] = useState("Local principal");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["salon", "whatsapp"]);

  const step = STEPS[currentStep];

  function next() {
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function prev() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  function handleSaveStep() {
    startTransition(async () => {
      let result: any;
      switch (step.key) {
        case "business":
          result = await saveBusinessStep({
            name: businessName || "Mi Negocio",
            industry,
          });
          break;
        case "branches":
          result = await saveBranchStep({
            branches: [{ name: branchName || "Local principal", isMain: true, type: "local" }],
          });
          break;
        case "channels":
          result = await saveChannelsStep();
          break;
        case "team":
          result = await saveTeamStep();
          break;
        case "whatsapp":
          result = await saveWhatsappStep();
          break;
        case "recipes":
          result = await seedIngredientsAndProducts(industry);
          break;
        case "finish":
          result = await completeOnboarding();
          if (result?.ok) {
            toast({ tone: "success", title: "¡Negocio configurado!", description: "Bienvenido a GastroPilot." });
            router.push("/");
            return;
          }
          break;
      }
      if (result?.ok) next();
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-dots opacity-30" />
      <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-ai-500/15 blur-3xl" />

      <div className="relative mx-auto max-w-2xl px-4 py-12 md:py-20">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[11px] font-medium text-brand-300">
            <Sparkles className="h-3 w-3" />
            GastroPilot AI · Configuración inicial
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            Armá tu negocio en 2 minutos.
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Después de esto podés empezar a mandar mensajes por WhatsApp y la IA se encarga del resto.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8 flex items-center justify-center gap-1">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i];
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <button
                key={s.key}
                onClick={() => i <= currentStep && setCurrentStep(i)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                  done && "bg-success-500/15 text-success-400",
                  active && "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30",
                  !done && !active && "bg-bg-subtle text-ink-subtle",
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{s.label}</span>
                {done && <Check className="h-3 w-3" />}
              </button>
            );
          })}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step.key}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="card p-6 md:p-8"
          >
            <div className="mb-6">
              <Badge tone="brand">Paso {currentStep + 1} de {STEPS.length}</Badge>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{step.label}</h2>
              <p className="mt-1 text-sm text-ink-muted">{step.description}</p>
            </div>

            {step.key === "business" && (
              <div className="space-y-4">
                <Field label="Nombre del negocio" value={businessName} onChange={setBusinessName} placeholder="La Birra Burger" />
                <div>
                  <label className="mb-2 block text-xs font-medium text-ink-muted">Rubro</label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {INDUSTRIES.map((i) => (
                      <button
                        key={i.key}
                        onClick={() => setIndustry(i.key)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          industry === i.key
                            ? "border-brand-500/40 bg-brand-500/[0.06]"
                            : "border-line bg-bg-subtle/40 hover:border-line-strong",
                        )}
                      >
                        <div className="text-sm font-semibold text-ink">{i.label}</div>
                        <div className="text-[10px] text-ink-muted">{i.tagline}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step.key === "branches" && (
              <div className="space-y-4">
                <Field label="Nombre del punto de venta" value={branchName} onChange={setBranchName} placeholder="Local Palermo" />
                <div>
                  <label className="mb-2 block text-xs font-medium text-ink-muted">Tipo</label>
                  <div className="grid grid-cols-2 gap-2">
                    {BRANCH_TYPES.map((b) => (
                      <div key={b.value} className="rounded-xl border border-line bg-bg-subtle/40 px-3 py-2 text-sm text-ink">
                        {b.label}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-ink-subtle">
                  Podés agregar más sucursales después desde Ajustes → Negocio.
                </p>
              </div>
            )}

            {step.key === "channels" && (
              <div className="space-y-2">
                {SALE_CHANNELS.map((c) => {
                  const active = selectedChannels.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      onClick={() =>
                        setSelectedChannels((prev) =>
                          active ? prev.filter((k) => k !== c.key) : [...prev, c.key],
                        )
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl border px-4 py-3 transition-colors",
                        active
                          ? "border-brand-500/40 bg-brand-500/[0.06]"
                          : "border-line bg-bg-subtle/40 hover:border-line-strong",
                      )}
                    >
                      <div className="text-left">
                        <div className="text-sm font-medium text-ink">{c.label}</div>
                        <div className="text-[10px] text-ink-muted">{c.hint}</div>
                      </div>
                      {active && <Check className="h-4 w-4 text-brand-400" />}
                    </button>
                  );
                })}
              </div>
            )}

            {step.key === "team" && (
              <div className="space-y-4">
                <p className="text-sm text-ink-muted">
                  Podés invitar a tu equipo ahora o hacerlo después desde Ajustes → Equipo.
                </p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {["Socio", "Encargado", "Contador", "Empleado"].map((r) => (
                    <div key={r} className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 px-4 py-3">
                      <UserPlus className="h-4 w-4 text-ink-muted" />
                      <div>
                        <div className="text-sm font-medium text-ink">Invitar {r}</div>
                        <div className="text-[10px] text-ink-subtle">Opcional ahora</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step.key === "whatsapp" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-success-500/25 bg-success-500/[0.04] p-4">
                  <div className="mb-2 flex items-center gap-2 text-success-400">
                    <MessageSquareText className="h-4 w-4" />
                    <span className="text-sm font-semibold">WhatsApp Business</span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Asigná un número de WhatsApp Business dedicado al negocio. Tu equipo va a
                    mandar fotos, audios y textos a ese número, y la IA los convierte en
                    registros.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-ink-subtle">Ejemplo de mensajes que la IA entiende:</div>
                  {[
                    `"Compramos 20kg de carne a Don José por 180mil"`,
                    `"Hoy vendimos $850.000: local 500, delivery 250, WA 100"`,
                    `"A Juan le dimos un adelanto de $30.000"`,
                  ].map((ex) => (
                    <div key={ex} className="rounded-lg border border-line bg-bg-subtle/60 px-3 py-2 text-xs text-ink italic">
                      {ex}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step.key === "recipes" && (
              <div className="space-y-4">
                <p className="text-sm text-ink-muted">
                  Según el rubro <span className="font-medium text-ink">{INDUSTRIES.find((i) => i.key === industry)?.label ?? industry}</span>,
                  te sugerimos estos ingredientes y productos iniciales. Podés modificarlos después.
                </p>
                <div className="rounded-xl border border-ai-400/25 bg-ai-500/[0.06] p-4">
                  <div className="mb-1 flex items-center gap-2 text-ai-400">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Seed IA por rubro
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    La IA carga ingredientes con costos estimados y productos base con recetas.
                    Vos los ajustás a tus precios reales.
                  </p>
                </div>
              </div>
            )}

            {step.key === "finish" && (
              <div className="space-y-4 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-success-500/30 bg-success-500/10">
                  <Rocket className="h-8 w-8 text-success-400" />
                </div>
                <h3 className="text-lg font-semibold text-ink">¡Tu negocio está listo!</h3>
                <p className="text-sm text-ink-muted">
                  Ya podés empezar a cargar movimientos desde WhatsApp. La IA se encarga de ordenar todo.
                </p>
                <div className="mx-auto grid max-w-xs gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/[0.04] px-3 py-2 text-xs text-ink">
                    <Check className="h-3 w-3 text-success-400" /> Negocio configurado
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/[0.04] px-3 py-2 text-xs text-ink">
                    <Check className="h-3 w-3 text-success-400" /> Ingredientes y productos cargados
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/[0.04] px-3 py-2 text-xs text-ink">
                    <Check className="h-3 w-3 text-success-400" /> WhatsApp preparado
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="ghost"
                size="md"
                onClick={prev}
                disabled={currentStep === 0 || pending}
              >
                <ArrowLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleSaveStep}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step.key === "finish" ? (
                  <Rocket className="h-4 w-4" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {step.key === "finish"
                  ? pending
                    ? "Finalizando…"
                    : "Ir al Dashboard"
                  : pending
                    ? "Guardando…"
                    : "Siguiente"}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/")}
            className="text-xs text-ink-subtle hover:text-ink"
          >
            Saltar configuración y entrar directo →
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}
