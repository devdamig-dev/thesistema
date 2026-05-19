"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bookmark,
  CalendarClock,
  Camera,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Flame,
  Heart,
  Instagram,
  MessageCircle,
  MessageSquareText,
  Phone,
  Play,
  Rocket,
  Send,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import {
  audienceSegments,
  bestHours,
  copyLibrary,
  CopyObjective,
  CopyTone,
  GrowthCampaign,
  growthInsights,
  growthSummary,
  suggestedCampaigns,
} from "@/lib/mock-data";
import { formatARS, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function MarketingPage() {
  return (
    <div className="space-y-10">
      <SectionHeader
        eyebrow="Marketing IA · Centro de crecimiento"
        title="Tu negocio sabe vender. La IA sabe a quién, cuándo y con qué mensaje."
        description="Detectamos oportunidades en tus datos y armamos campañas listas para enviar por WhatsApp e Instagram. Vos sólo aprobás."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <CalendarClock className="h-4 w-4" />
              Mayo · Calendario
            </Button>
            <Button size="sm" variant="ai">
              <Wand2 className="h-4 w-4" />
              Pedirle al copiloto
            </Button>
          </>
        }
      />

      {/* Hero opportunity */}
      <OpportunityHero />

      {/* Insights estratégicos */}
      <InsightsBoard />

      {/* Campañas sugeridas con preview */}
      <SuggestedCampaigns />

      {/* Estudio de copies */}
      <CopyStudio />

      {/* Audiencias + horarios */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <AudiencesGrid />
        <BestHoursPanel />
      </div>
    </div>
  );
}

/* ============================================================
   HERO — oportunidad detectada
   ============================================================ */
function OpportunityHero() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-bg-elevated/60 surface-raised">
      <div className="absolute inset-0 grid-dots opacity-50" />
      <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-ai-500/20 blur-3xl" />
      <div className="absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.3fr_1fr] md:gap-10 md:p-10">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-ai-400/30 bg-ai-500/10 px-2.5 py-1 text-[11px] font-medium text-ai-400">
            <Sparkles className="h-3 w-3" />
            Centro de crecimiento · semana del 13 al 19 de mayo
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink md:text-[2rem] md:leading-[1.15]">
            Detectamos{" "}
            <span className="text-gradient-ai">
              {formatARS(growthSummary.oportunidadMes, { compact: true })}
            </span>{" "}
            de oportunidad este mes.{" "}
            <span className="text-ink-muted">
              6 campañas listas para activar.
            </span>
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-ink-muted">
            Cruzamos ventas por día, productos con mejor rentabilidad, frecuencia de compra y comportamiento por canal. La IA prioriza lo que más mueve la aguja esta semana.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="ai" size="md">
              <Rocket className="h-4 w-4" />
              Generar plan semanal
            </Button>
            <Button variant="ghost" size="md">
              <Target className="h-4 w-4" />
              Ver segmentos
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <OppMetric
            icon={TrendingUp}
            label="Oportunidad detectada"
            value={formatARS(growthSummary.oportunidadMes, { compact: true })}
            hint="Mes en curso"
            tone="brand"
          />
          <OppMetric
            icon={Users}
            label="Clientes para reactivar"
            value={String(growthSummary.clientesReactivar)}
            hint=">21 días sin pedir"
            tone="warn"
          />
          <OppMetric
            icon={Wand2}
            label="Campañas sugeridas"
            value={String(growthSummary.campanasSugeridas)}
            hint="2 listas para enviar"
            tone="ai"
          />
          <OppMetric
            icon={Flame}
            label="Productos a empujar"
            value={String(growthSummary.productosSubperformantes)}
            hint="Alto margen, baja salida"
            tone="success"
          />
        </div>
      </div>
    </div>
  );
}

function OppMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  hint: string;
  tone: "brand" | "warn" | "ai" | "success";
}) {
  const accent = {
    brand: "text-brand-300",
    warn: "text-warn-400",
    ai: "text-ai-400",
    success: "text-success-400",
  }[tone];
  return (
    <div className="card-quiet p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-subtle">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("mt-1.5 text-xl font-semibold tabular-nums", accent)}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-subtle">{hint}</div>
    </div>
  );
}

/* ============================================================
   INSIGHTS — recomendaciones estratégicas
   ============================================================ */
function InsightsBoard() {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="eyebrow mb-1 flex items-center gap-1.5 text-ai-400">
            <Sparkles className="h-3 w-3" /> Insights accionables
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Oportunidades detectadas esta semana
          </h2>
        </div>
        <Badge tone="ai">{growthInsights.length} insights</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {growthInsights.map((g, idx) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.04 }}
            className="card relative overflow-hidden p-5"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ai-500/10 blur-3xl" />
            <div className="relative">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={g.prioridad} />
                  <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    · {g.area}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-ai-400 tabular-nums">
                  {Math.round(g.confianza * 100)}%
                </span>
              </div>
              <h3 className="text-base font-semibold tracking-tight text-ink leading-snug">
                {g.titulo}
              </h3>
              <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                {g.detalle}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-success-500/25 bg-success-500/[0.06] p-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-success-400/80">
                    Impacto estimado
                  </div>
                  <div className="text-sm font-semibold text-success-400 tabular-nums">
                    {g.impacto}
                  </div>
                </div>
                <Rocket className="h-4 w-4 text-success-400/50" />
              </div>
              <div className="mt-3">
                <Button variant="ai" size="sm" className="w-full">
                  <Wand2 className="h-3.5 w-3.5" />
                  {g.cta}
                </Button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   CAMPAÑAS SUGERIDAS con preview real
   ============================================================ */
function SuggestedCampaigns() {
  const [filter, setFilter] = useState<"todas" | "WhatsApp" | "Instagram">("todas");
  const filtered = useMemo(
    () =>
      filter === "todas"
        ? suggestedCampaigns
        : suggestedCampaigns.filter((c) => c.canal === filter),
    [filter],
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1 flex items-center gap-1.5 text-brand-300">
            <Send className="h-3 w-3" /> Campañas sugeridas
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Listas para enviar. Personalizadas para tu base.
          </h2>
        </div>
        <SegmentedTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todas", label: "Todas", count: suggestedCampaigns.length },
            {
              value: "WhatsApp",
              label: "WhatsApp",
              count: suggestedCampaigns.filter((c) => c.canal === "WhatsApp").length,
            },
            {
              value: "Instagram",
              label: "Instagram",
              count: suggestedCampaigns.filter((c) => c.canal === "Instagram").length,
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {filtered.map((c) => (
          <CampaignCard key={c.id} campaign={c} />
        ))}
      </div>
    </section>
  );
}

function CampaignCard({ campaign: c }: { campaign: GrowthCampaign }) {
  const channelTone =
    c.canal === "WhatsApp"
      ? "border-success-500/25 bg-success-500/10 text-success-400"
      : "border-ai-400/25 bg-ai-500/10 text-ai-400";

  return (
    <div className="card grid grid-cols-1 overflow-hidden md:grid-cols-[1fr_280px]">
      {/* Info */}
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className={cn(
                "mb-1.5 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                channelTone,
              )}
            >
              {c.canal === "WhatsApp" ? (
                <MessageSquareText className="h-3 w-3" />
              ) : (
                <Instagram className="h-3 w-3" />
              )}
              {c.canal} · {c.tipo}
            </div>
            <h3 className="text-base font-semibold tracking-tight text-ink">{c.nombre}</h3>
          </div>
          <CampaignStatusChip status={c.estado} />
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-bg-subtle/40 p-3">
          <Mini label="Audiencia" value={c.audiencia} />
          <Mini label="Alcance" value={formatNumber(c.alcance)} />
          <Mini label="Mejor horario" value={c.horario} icon={Clock3} />
          <Mini label="Confianza IA" value={`${Math.round(c.confianza * 100)}%`} tone="ai" />
        </div>

        <div className="rounded-xl border border-success-500/25 bg-success-500/[0.05] p-3">
          <div className="text-[10px] uppercase tracking-wider text-success-400/80">
            Impacto estimado
          </div>
          <div className="text-sm font-semibold text-success-400 tabular-nums">
            {c.impacto}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="primary" size="sm">
            <Rocket className="h-3.5 w-3.5" />
            {c.estado === "lista" ? "Enviar campaña" : "Generar copies"}
          </Button>
          <Button variant="ghost" size="sm">
            <CalendarClock className="h-3.5 w-3.5" />
            Programar
          </Button>
          <Button variant="ghost" size="sm">
            Editar audiencia
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="relative border-t border-line bg-bg-subtle/40 p-4 md:border-l md:border-t-0">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="relative">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-ink-subtle">
            Preview
          </div>
          {c.canal === "WhatsApp" ? (
            <WhatsAppBubble text={c.copy} cta={c.cta} />
          ) : (
            <InstagramMock caption={c.caption ?? c.copy} cta={c.cta} />
          )}
        </div>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: any;
  tone?: "ai";
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-subtle">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={cn("mt-0.5 text-sm text-ink", tone === "ai" && "text-ai-400 font-semibold")}>
        {value}
      </div>
    </div>
  );
}

function CampaignStatusChip({ status }: { status: GrowthCampaign["estado"] }) {
  if (status === "lista")
    return (
      <Badge tone="success">
        <Check className="h-3 w-3" />
        Lista para enviar
      </Badge>
    );
  if (status === "programada")
    return (
      <Badge tone="ai">
        <CalendarClock className="h-3 w-3" />
        Programada
      </Badge>
    );
  return (
    <Badge tone="brand">
      <Sparkles className="h-3 w-3" />
      Sugerida
    </Badge>
  );
}

/* ============================================================
   PREVIEWS — burbuja WhatsApp + post Instagram
   ============================================================ */
function WhatsAppBubble({ text, cta }: { text: string; cta?: string }) {
  return (
    <div className="relative mx-auto max-w-[260px] rounded-2xl border border-line bg-[#0b1410] p-3 shadow-soft">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2 border-b border-line/50 pb-2">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[10px] font-bold text-white">
          LB
        </div>
        <div className="leading-tight">
          <div className="text-[11px] font-semibold text-ink">La Birra Burger</div>
          <div className="text-[9px] text-success-400">en línea</div>
        </div>
        <Phone className="ml-auto h-3 w-3 text-ink-subtle" />
      </div>
      {/* Bubble */}
      <div className="relative ml-auto max-w-[230px] rounded-2xl rounded-tr-sm bg-success-500/10 px-3 py-2 ring-1 ring-success-500/20">
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink font-sans">
          {text}
        </pre>
        {cta && (
          <div className="mt-2 rounded-lg border border-success-500/30 bg-success-500/15 px-2 py-1 text-center text-[10px] font-semibold text-success-400">
            {cta}
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-success-400/70">
          14:32 <CheckCheck className="h-2.5 w-2.5" />
        </div>
      </div>
    </div>
  );
}

function InstagramMock({ caption, cta }: { caption: string; cta?: string }) {
  return (
    <div className="relative mx-auto max-w-[260px] overflow-hidden rounded-2xl border border-line bg-bg-elevated shadow-soft">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-brand-400 via-danger-500 to-ai-500 p-[1.5px]">
          <div className="grid h-full w-full place-items-center rounded-full bg-bg-elevated text-[8px] font-bold text-ink">
            LB
          </div>
        </div>
        <div className="leading-tight">
          <div className="text-[11px] font-semibold text-ink">labirraburger</div>
          <div className="text-[9px] text-ink-subtle">Palermo, Buenos Aires</div>
        </div>
      </div>
      {/* Imagen mock */}
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-brand-700/60 via-brand-500/40 to-ai-500/20">
        <div className="grid-dots absolute inset-0 opacity-40" />
        <div className="absolute inset-0 grid place-items-center">
          <Camera className="h-8 w-8 text-white/40" />
        </div>
        {cta && (
          <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur">
            {cta}
          </div>
        )}
      </div>
      {/* Acciones */}
      <div className="flex items-center gap-3 px-3 pt-2 text-ink">
        <Heart className="h-4 w-4" />
        <MessageCircle className="h-4 w-4" />
        <Share2 className="h-4 w-4" />
        <Bookmark className="ml-auto h-4 w-4" />
      </div>
      {/* Caption */}
      <div className="px-3 py-2 text-[11px] leading-relaxed text-ink">
        <span className="font-semibold">labirraburger</span>{" "}
        <span className="text-ink-muted">{caption}</span>
      </div>
    </div>
  );
}

/* ============================================================
   COPY STUDIO — generador interactivo
   ============================================================ */
function CopyStudio() {
  const [tone, setTone] = useState<CopyTone>("Cercano");
  const [objective, setObjective] = useState<CopyObjective>("Promo");
  const [copied, setCopied] = useState<"whatsapp" | "instagram" | null>(null);

  const key = `${tone}|${objective}`;
  const generated = copyLibrary[key] ?? copyLibrary["Cercano|Promo"];

  const handleCopy = (which: "whatsapp" | "instagram") => {
    navigator.clipboard?.writeText(which === "whatsapp" ? generated.whatsapp : generated.instagram);
    setCopied(which);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1 flex items-center gap-1.5 text-ai-400">
            <Wand2 className="h-3 w-3" /> Estudio de copies
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Generá mensajes que suenan tuyos.
          </h2>
        </div>
        <Badge tone="ai">Powered by IA</Badge>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[280px_1fr]">
          {/* Controles */}
          <div className="space-y-5 border-b border-line bg-bg-subtle/40 p-5 lg:border-b-0 lg:border-r">
            <div>
              <div className="eyebrow mb-2">Tono</div>
              <div className="flex flex-wrap gap-1.5">
                {(["Cercano", "Premium", "Divertido", "Urgente"] as CopyTone[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      tone === t
                        ? "border-ai-400/40 bg-ai-500/15 text-ai-400"
                        : "border-line bg-bg-subtle text-ink-muted hover:text-ink",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="eyebrow mb-2">Objetivo</div>
              <div className="flex flex-wrap gap-1.5">
                {(["Promo", "Reactivación", "Lanzamiento", "Recordatorio"] as CopyObjective[]).map(
                  (o) => (
                    <button
                      key={o}
                      onClick={() => setObjective(o)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        objective === o
                          ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                          : "border-line bg-bg-subtle text-ink-muted hover:text-ink",
                      )}
                    >
                      {o}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-bg-elevated/60 p-3 text-xs text-ink-muted">
              La IA combina la voz de marca con tus mejores horarios y el historial de
              respuesta de cada audiencia para optimizar el copy.
            </div>

            <Button variant="ai" size="md" className="w-full">
              <Wand2 className="h-4 w-4" />
              Generar otra variante
            </Button>
          </div>

          {/* Salida */}
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <CopyBox
              channel="whatsapp"
              text={generated.whatsapp}
              copied={copied === "whatsapp"}
              onCopy={() => handleCopy("whatsapp")}
            />
            <CopyBox
              channel="instagram"
              text={generated.instagram}
              copied={copied === "instagram"}
              onCopy={() => handleCopy("instagram")}
            />
          </div>
        </div>
      </Card>
    </section>
  );
}

function CopyBox({
  channel,
  text,
  copied,
  onCopy,
}: {
  channel: "whatsapp" | "instagram";
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const isWA = channel === "whatsapp";
  const Icon = isWA ? MessageSquareText : Instagram;
  return (
    <div className="card-quiet flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-2">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            isWA
              ? "border-success-500/25 bg-success-500/10 text-success-400"
              : "border-ai-400/25 bg-ai-500/10 text-ai-400",
          )}
        >
          <Icon className="h-3 w-3" />
          {isWA ? "WhatsApp" : "Instagram"}
        </div>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-bg-subtle px-2 py-1 text-[10px] font-medium text-ink-muted hover:text-ink"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success-400" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copiar
            </>
          )}
        </button>
      </div>
      <pre className="flex-1 whitespace-pre-wrap p-3 text-xs leading-relaxed text-ink font-sans">
        {text}
      </pre>
      <div className="border-t border-line/70 bg-bg-subtle/40 px-3 py-2">
        <button className="text-[11px] font-medium text-brand-300 hover:text-brand-200">
          Usar este copy
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   AUDIENCIAS
   ============================================================ */
function AudiencesGrid() {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Audiencias detectadas
          </CardTitle>
          <p className="mt-0.5 text-xs text-ink-muted">
            Segmentos vivos generados con tu base de clientes
          </p>
        </div>
        <Badge tone="default">{audienceSegments.length}</Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceSegments.map((a) => {
          const toneClass = {
            brand: "border-brand-500/25 bg-brand-500/[0.05]",
            success: "border-success-500/25 bg-success-500/[0.05]",
            warn: "border-warn-500/25 bg-warn-500/[0.05]",
            ai: "border-ai-400/25 bg-ai-500/[0.05]",
          }[a.tone];
          const text = {
            brand: "text-brand-300",
            success: "text-success-400",
            warn: "text-warn-400",
            ai: "text-ai-400",
          }[a.tone];
          return (
            <div
              key={a.id}
              className={cn("relative overflow-hidden rounded-2xl border p-4", toneClass)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-subtle">
                    Segmento
                  </div>
                  <h3 className="mt-0.5 text-base font-semibold text-ink">{a.nombre}</h3>
                </div>
                <span className={cn("text-2xl font-semibold tabular-nums", text)}>
                  {formatNumber(a.size)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    Ticket prom.
                  </div>
                  <div className="text-ink tabular-nums">
                    {a.ticketProm ? formatARS(a.ticketProm) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    Última compra
                  </div>
                  <div className="text-ink">{a.recencia}</div>
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-bg-subtle/60 p-2.5">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-ai-400" />
                <span className="text-[11px] leading-relaxed text-ink-muted">
                  {a.recomendacion}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" size="sm">
                  Ver clientes
                </Button>
                <Button variant="ai" size="sm">
                  <Send className="h-3.5 w-3.5" />
                  Activar
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ============================================================
   MEJORES HORARIOS
   ============================================================ */
function BestHoursPanel() {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Cuándo publicar
          </CardTitle>
          <p className="mt-0.5 text-xs text-ink-muted">
            Picos de conversión por canal y día
          </p>
        </div>
        <Badge tone="ai">Datos últimos 60 días</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {bestHours.map((h, idx) => {
          const isWA = h.medio === "WhatsApp";
          return (
            <div
              key={idx}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-subtle/50 p-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border",
                    isWA
                      ? "border-success-500/25 bg-success-500/10 text-success-400"
                      : "border-ai-400/25 bg-ai-500/10 text-ai-400",
                  )}
                >
                  {isWA ? <MessageSquareText className="h-4 w-4" /> : <Instagram className="h-4 w-4" />}
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-ink">
                    {h.dia} · {h.tramo}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    {h.medio}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                  Conversión
                </div>
                <div className="text-sm font-semibold text-success-400 tabular-nums">
                  {h.conversion.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-ai-400/25 bg-ai-500/[0.06] p-3">
          <Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ai-400" />
          <span className="text-xs text-ink">
            La IA puede programar automáticamente tus campañas en estos horarios.{" "}
            <button className="font-semibold text-ai-400 hover:text-ai-300">
              Activar agenda inteligente →
            </button>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
