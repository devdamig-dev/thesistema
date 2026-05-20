"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ClipboardList,
  FileText,
  Inbox,
  MessageCircle,
  Phone,
  PlayCircle,
  Search,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast, ToastPresets } from "@/components/ui/toast";

const CATEGORIES = [
  {
    icon: Inbox,
    title: "Inbox IA y WhatsApp",
    detail: "Cómo cargar movimientos desde mensajes, fotos y audios.",
    href: "/inbox",
    badge: "Más usado",
  },
  {
    icon: FileText,
    title: "Facturas con OCR",
    detail: "Subir facturas, validar campos y enviarlas al contador.",
    href: "/facturas",
  },
  {
    icon: ClipboardList,
    title: "Cierres diarios",
    detail: "Cómo escribir un cierre que la IA pueda interpretar bien.",
    href: "/cierres",
  },
  {
    icon: Sparkles,
    title: "Reportes y Marketing IA",
    detail: "Hacerle preguntas al copiloto y activar campañas.",
    href: "/reportes",
  },
  {
    icon: Workflow,
    title: "Productos y recetas",
    detail: "Cargar recetas, controlar costos y simular impactos.",
    href: "/productos",
  },
  {
    icon: Zap,
    title: "Integraciones",
    detail: "WhatsApp Business, Mercado Pago, Pedidos Ya y más.",
    href: "/ajustes/whatsapp",
  },
];

const FAQ = [
  {
    q: "¿Cómo conecto WhatsApp con GastroPilot?",
    a: "Andá a Ajustes › WhatsApp y escaneá el QR con la cuenta de WhatsApp Business. La conexión queda activa para todo tu equipo.",
  },
  {
    q: "¿Quién puede aprobar facturas y cierres?",
    a: "Sólo los usuarios con rol Encargado, Socio o Contador. Los empleados pueden cargar pero no aprobar.",
  },
  {
    q: "¿La IA aprende mi voz de marca?",
    a: "Sí. Después de la primera semana, la IA ajusta tono y estilo según cómo escribís y aprobás campañas.",
  },
  {
    q: "¿Qué pasa si la IA se equivoca?",
    a: "Cada registro queda como borrador hasta que vos lo aprobás. Si la IA marca dato faltante, se pregunta automáticamente por WhatsApp.",
  },
  {
    q: "¿Puedo exportar mi info para el contador?",
    a: "Sí, desde Facturas y Reportes con un click. Se exporta en CSV, PDF y formato AFIP-friendly.",
  },
  {
    q: "¿Funciona con varias sucursales o foodtrucks?",
    a: "Sí, podés agregar puntos de venta desde Ajustes › Negocio y filtrar todas las vistas por sucursal.",
  },
];

export default function AyudaPage() {
  const [query, setQuery] = useState("");
  const { toast } = useToast();
  const filtered = FAQ.filter(
    (f) =>
      f.q.toLowerCase().includes(query.toLowerCase()) ||
      f.a.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Centro de ayuda"
        title="¿En qué te ayudamos?"
        description="Buscá una guía, revisá las preguntas frecuentes o escribinos. Estamos para que GastroPilot ordene tu negocio en serio."
      />

      {/* Buscador */}
      <div className="card relative overflow-hidden p-2">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="relative flex items-center gap-2 rounded-xl border border-line bg-bg-elevated px-3 py-2">
          <Search className="h-4 w-4 text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar guías, integraciones, problemas conocidos…"
            className="h-9 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
          />
          <Badge tone="ai">
            <Sparkles className="h-3 w-3" />
            IA
          </Badge>
        </div>
      </div>

      {/* Categorías */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-subtle">
          Explorá por tema
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.title}
                href={c.href}
                className="card group p-5 transition-all hover:border-line-strong hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]"
              >
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-bg-subtle">
                    <Icon className="h-5 w-5 text-brand-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
                      {c.badge && <Badge tone="ai">{c.badge}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                      {c.detail}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-300 transition-colors group-hover:text-brand-200">
                      Ver guías
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* FAQ + contacto */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Preguntas frecuentes
            </CardTitle>
            <Badge tone="default">{filtered.length}</Badge>
          </CardHeader>
          <CardContent className="divide-y divide-line/60">
            {filtered.map((item, idx) => (
              <FaqRow key={idx} q={item.q} a={item.a} defaultOpen={idx === 0} />
            ))}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-ink-muted">
                Sin resultados. Probá con otra palabra clave.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-gradient-to-br from-ai-500/[0.08] to-bg-elevated p-5">
              <Badge tone="ai">
                <Sparkles className="h-3 w-3" /> Tu copiloto
              </Badge>
              <h3 className="mt-2 text-base font-semibold tracking-tight text-ink">
                Preguntale directo al copiloto
              </h3>
              <p className="mt-1 text-xs text-ink-muted">
                Resuelve dudas de uso, ejemplos de mensajes y mejores prácticas en
                segundos.
              </p>
              <Link href="/reportes">
                <Button variant="ai" size="sm" className="mt-3">
                  <Sparkles className="h-3.5 w-3.5" />
                  Abrir copiloto
                </Button>
              </Link>
            </div>
            <CardContent className="space-y-3">
              <ContactRow
                icon={MessageCircle}
                label="Chat con soporte"
                value="Lun a sáb · 9 a 22 hs"
                onClick={() =>
                  toast({
                    tone: "ai",
                    title: "Conectando con soporte…",
                    description: "Te respondemos en menos de 5 minutos.",
                  })
                }
              />
              <ContactRow
                icon={Phone}
                label="WhatsApp soporte"
                value="+54 9 11 5556-7700"
                onClick={() =>
                  toast({
                    tone: "ai",
                    title: "Abriendo WhatsApp",
                    description: "Te abrimos un chat con el equipo de soporte.",
                  })
                }
              />
              <ContactRow
                icon={PlayCircle}
                label="Videos cortos"
                value="6 tutoriales · 2-3 min cada uno"
                onClick={() => toast(ToastPresets.comingSoon("Videoteca"))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FaqRow({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="block w-full py-3 text-left"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{q}</span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </div>
      {open && (
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{a}</p>
      )}
    </button>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: any;
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3 text-left transition-colors hover:border-line-strong hover:bg-bg-subtle"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg-elevated text-ink-muted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-xs text-ink-muted">{value}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-ink-subtle" />
    </button>
  );
}
