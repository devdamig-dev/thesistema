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
import {
  STEPS,
  SALE_CHANNELS,
  BRANCH_TYPES,
  type BranchType,
} from "@/lib/onboarding/types";
import { INDUSTRIES } from "@/lib/industries";
import type { Industry } from "@/lib/entities";
import type { Role } from "@/lib/permissions";
import {
  saveBusinessStep,
  saveBranchStep,
  saveChannelsStep,
  saveTeamStep,
  saveWhatsappStep,
  seedIngredientsAndProducts,
  completeOnboarding,
} from "@/app/actions/onboarding";
import { inviteUserAction } from "@/app/actions/team";
import { cn } from "@/lib/utils";

const STEP_ICONS = [Building2, MapPin, CreditCard, UserPlus, MessageSquareText, ChefHat, Rocket];
const TEAM_ROLES: { role: Role; label: string }[] = [
  { role: "owner", label: "Socio" },
  { role: "manager", label: "Encargado" },
  { role: "accountant", label: "Contador" },
  { role: "employee", label: "Empleado" },
];

export default function OnboardingClient() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [currentStep, setCurrentStep] = useState(0);

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState<Industry>("hamburgueseria");
  const [branchName, setBranchName] = useState("Local principal");
  const [branchType, setBranchType] = useState<BranchType>("local");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["salon", "whatsapp"]);
  const [inviteRole, setInviteRole] = useState<Role>("manager");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePending, setInvitePending] = useState(false);

  const step = STEPS[currentStep];

  function next() {
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function prev() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      toast({ tone: "warn", title: "Ingresá un email válido" });
      return;
    }

    setInvitePending(true);
    try {
      const result = await inviteUserAction({ email, role: inviteRole });
      if (!result.ok) {
        toast({ tone: "warn", title: "No pudimos crear la invitación", description: result.error });
        return;
      }
      toast({
        tone: "success",
        title: "Invitación creada",
        description: "Quedó registrada en Equipo. El envío automático por email se configura por separado.",
      });
      setInviteEmail("");
    } finally {
      setInvitePending(false);
    }
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
            branches: [{
              name: branchName || "Local principal",
              isMain: true,
              type: branchType,
            }],
          });
          break;
        case "channels":
          result = await saveChannelsStep(selectedChannels);
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
            toast({ tone: "success", title: "¡Negocio configurado!", description: "Ya podés empezar a cargar información real." });
            router.push("/");
            return;
          }
          break;
      }

      if (result?.ok) {
        next();
      } else if (result?.error) {
        toast({ tone: "warn", title: "No pudimos guardar este paso", description: result.error });
      }
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-dots opacity-30" />
      <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-ai-500/15 blur-3xl" />

      <div className="relative mx-auto max-w-2xl px-4 py-12 md:py-20">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[11px] font-medium text-brand-300">
            <Sparkles className="h-3 w-3" />
            GastroPilot AI · Configuración inicial
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-ink md:text-4xl">
            Armá tu negocio en pocos pasos.
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Lo que completes acá queda guardado en tu negocio real. Las integraciones pendientes se muestran como pendientes.
          </p>
        </div>

        <div className="mb-8 flex items-center justify-center gap-1">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i];
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <button
                key={s.key}
                type="button"
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
                <Field label="Nombre del negocio" value={businessName} onChange={setBusinessName} placeholder="Mi negocio" />
                <div>
                  <label className="mb-2 block text-xs font-medium text-ink-muted">Rubro</label>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {INDUSTRIES.map((i) => (
                      <button
                        type="button"
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
                <Field label="Nombre del punto de venta" value={branchName} onChange={setBranchName} placeholder="Local principal" />
                <div>
                  <label className="mb-2 block text-xs font-medium text-ink-muted">Tipo</label>
                  <div className="grid grid-cols-2 gap-2">
                    {BRANCH_TYPES.map((b) => (
                      <button
                        type="button"
                        key={b.value}
                        onClick={() => setBranchType(b.value)}
                        className={cn(
                          "flex items-center justify-between rounded-xl border px-3 py-3 text-left text-sm transition-colors",
                          branchType === b.value
                            ? "border-brand-500/40 bg-brand-500/[0.06] text-ink"
                            : "border-line bg-bg-subtle/40 text-ink hover:border-line-strong",
                        )}
                      >
                        {b.label}
                        {branchType === b.value && <Check className="h-4 w-4 text-brand-400" />}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-ink-subtle">
                  El tipo elegido se guarda en la sucursal principal. Podés agregar más puntos de venta después.
                </p>
              </div>
            )}

            {step.key === "channels" && (
              <div className="space-y-2">
                {SALE_CHANNELS.map((c) => {
                  const active = selectedChannels.includes(c.key);
                  return (
                    <button
                      type="button"
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
                  Elegí un rol e ingresá el email. También podés omitir este paso y hacerlo después desde Ajustes → Equipo.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {TEAM_ROLES.map((item) => (
                    <button
                      type="button"
                      key={item.role}
                      onClick={() => setInviteRole(item.role)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                        inviteRole === item.role
                          ? "border-brand-500/40 bg-brand-500/[0.06]"
                          : "border-line bg-bg-subtle/40 hover:border-line-strong",
                      )}
                    >
                      <UserPlus className="h-4 w-4 text-ink-muted" />
                      <div>
                        <div className="text-sm font-medium text-ink">{item.label}</div>
                        <div className="text-[10px] text-ink-subtle">Invitación opcional</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="persona@empresa.com"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <Button type="button" variant="ghost" size="md" onClick={handleInvite} disabled={invitePending}>
                    {invitePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Crear invitación
                  </Button>
                </div>
                <p className="text-[11px] text-ink-subtle">
                  La invitación queda registrada. El envío automático por email todavía no forma parte de este piloto.
                </p>
              </div>
            )}

            {step.key === "whatsapp" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-warn-500/25 bg-warn-500/[0.05] p-4">
                  <div className="mb-2 flex items-center gap-2 text-warn-400">
                    <MessageSquareText className="h-4 w-4" />
                    <span className="text-sm font-semibold">WhatsApp todavía no está conectado</span>
                  </div>
                  <p className="text-xs leading-relaxed text-ink-muted">
                    La integración con Meta/WhatsApp Business se completa desde Ajustes → WhatsApp. Podés continuar el onboarding sin conectarlo ahora.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-ink-subtle">Cuando lo conectes, la IA va a poder interpretar mensajes como:</div>
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
                  Según el rubro <span className="font-medium text-ink">{INDUSTRIES.find((i) => i.key === industry)?.label ?? industry}</span>, te sugerimos ingredientes y productos iniciales. Podés modificarlos después.
                </p>
                <div className="rounded-xl border border-ai-400/25 bg-ai-500/[0.06] p-4">
                  <div className="mb-1 flex items-center gap-2 text-ai-400">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Seed IA por rubro</span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    Se cargan ingredientes con costos estimados y productos base para que los ajustes a tus valores reales.
                  </p>
                </div>
              </div>
            )}

            {step.key === "finish" && (
              <div className="space-y-4 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-success-500/30 bg-success-500/10">
                  <Rocket className="h-8 w-8 text-success-400" />
                </div>
                <h3 className="text-lg font-semibold text-ink">¡La configuración inicial está lista!</h3>
                <p className="text-sm text-ink-muted">
                  Ya podés entrar al dashboard y empezar a cargar datos. WhatsApp queda como integración pendiente hasta que la conectemos realmente.
                </p>
                <div className="mx-auto grid max-w-sm gap-2 text-left">
                  <div className="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/[0.04] px-3 py-2 text-xs text-ink">
                    <Check className="h-3 w-3 text-success-400" /> Negocio configurado
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/[0.04] px-3 py-2 text-xs text-ink">
                    <Check className="h-3 w-3 text-success-400" /> Ingredientes y productos base cargados
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-warn-500/20 bg-warn-500/[0.04] px-3 py-2 text-xs text-ink">
                    <MessageSquareText className="h-3 w-3 text-warn-400" /> WhatsApp pendiente de conexión
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" size="md" onClick={prev} disabled={currentStep === 0 || pending}>
                <ArrowLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button variant="primary" size="md" onClick={handleSaveStep} disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : step.key === "finish" ? (
                  <Rocket className="h-4 w-4" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {step.key === "finish"
                  ? pending ? "Finalizando…" : "Ir al Dashboard"
                  : pending ? "Guardando…" : "Siguiente"}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
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
