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
  Search,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
    detail: "Configuración de WhatsApp y permisos de los servicios disponibles.",
    href: "/ajustes/whatsapp",
  },
];

const FAQ = [
  {
    q: "¿Cómo conecto WhatsApp con GastroPilot?",
    a: "Entrá en Ajustes › WhatsApp y seguí el proceso de conexión oficial de Meta disponible para tu cuenta. Verificá los permisos, el número y la llegada de un mensaje de prueba antes de considerar el canal operativo.",
  },
  {
    q: "¿Quién puede aprobar facturas y cierres?",
    a: "Sólo los usuarios con rol Encargado, Socio o Contador. Los empleados pueden cargar pero no aprobar.",
  },
  {
    q: "¿Cómo sé si tengo la IA disponible?",
    a: "Revisá Ajustes › IA para conocer el proveedor, el plan y el estado de consumo disponibles para tu negocio. Sin una configuración activa o cuota suficiente, algunas respuestas pueden no estar disponibles.",
  },
  {
    q: "¿Qué pasa si la IA se equivoca?",
    a: "Las operaciones sensibles tienen revisiones y confirmaciones según el rol. Las fuentes de WhatsApp configuradas para solo lectura no responden automáticamente ni ejecutan operaciones.",
  },
  {
    q: "¿Dónde reviso los datos para mi contador?",
    a: "Consultá Facturas y Reportes para ver los registros disponibles. Las opciones de descarga dependen del módulo; no todas las vistas ofrecen los mismos formatos.",
  },
  {
    q: "¿Funciona con varias sucursales o foodtrucks?",
    a: "Sí, podés agregar puntos de venta desde Ajustes › Negocio y filtrar todas las vistas por sucursal.",
  },
];

export default function AyudaPage() {
  const [query, setQuery] = useState("");
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
        description="Buscá una guía, revisá las preguntas frecuentes y entrá a las herramientas de configuración disponibles."
      />

      {/* Buscador */}
      <div className="card relative overflow-hidden p-2">
        <div className="absolute inset-0 grid-dots opacity-30" />
        <div className="relative flex items-center gap-2 rounded-xl border border-line bg-bg-elevated px-3 py-2">
          <Search className="h-4 w-4 text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar en preguntas frecuentes…"
            className="h-9 flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
          />
          <Badge tone="default">Buscar</Badge>
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
                Consultá reportes y herramientas disponibles. Las respuestas de IA dependen
                de la configuración y el plan de tu negocio.
              </p>
              <Link href="/reportes">
                <Button variant="ai" size="sm" className="mt-3">
                  <Sparkles className="h-3.5 w-3.5" />
                  Abrir reportes
                </Button>
              </Link>
            </div>
            <CardContent className="space-y-3">
              <HelpLinkRow
                icon={BookOpen}
                label="Guía del piloto"
                value="Configuración y recorridos operativos"
                href="/ayuda/piloto"
              />
              <HelpLinkRow
                icon={Workflow}
                label="Configurar WhatsApp"
                value="Revisar conexión y permisos del canal"
                href="/ajustes/whatsapp"
              />
              <HelpLinkRow
                icon={Sparkles}
                label="Estado de la IA"
                value="Consultar plan y disponibilidad del motor"
                href="/ajustes/ia"
              />
              <p className="text-xs leading-relaxed text-ink-muted">
                Los canales de soporte directo todavía no están habilitados en esta sección.
                No mostramos teléfonos ni tiempos de respuesta sin un servicio verificado.
              </p>
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

function HelpLinkRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3 text-left transition-colors hover:border-line-strong hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg-elevated text-ink-muted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-xs text-ink-muted">{value}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-ink-subtle" />
    </Link>
  );
}
