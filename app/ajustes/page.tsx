import Link from "next/link";
import {
  Bot,
  Building2,
  ChefHat,
  ChevronRight,
  MessageSquareText,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CARDS = [
  {
    href: "/ajustes/negocio",
    icon: Building2,
    title: "Datos del negocio",
    detail: "Razón social, CUIT, sucursales, canales de venta y medios de pago.",
    chip: "5 secciones",
  },
  {
    href: "/ajustes/rubro",
    icon: ChefHat,
    title: "Rubro gastronómico",
    detail: "Adaptá los módulos visibles según tu tipo de negocio.",
    chip: "Hamburguesería",
  },
  {
    href: "/ajustes/whatsapp",
    icon: MessageSquareText,
    title: "WhatsApp conectado",
    detail: "Número activo, miembros autorizados y plantillas de respuesta.",
    chip: "Conectado",
    tone: "success" as const,
  },
  {
    href: "/ajustes/ia",
    icon: Bot,
    title: "Preferencias de IA",
    detail: "Tono de respuestas, créditos, automatizaciones y módulos activos.",
    chip: "Plan Pro",
    tone: "ai" as const,
  },
  {
    href: "/ajustes/equipo",
    icon: Users,
    title: "Equipo y permisos",
    detail: "Usuarios, roles, accesos del contador y notificaciones.",
    chip: "6 usuarios",
  },
];

export default function AjustesResumenPage() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {CARDS.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.href}
            href={c.href}
            className="card group p-5 transition-all hover:border-line-strong hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-bg-subtle">
                <Icon className="h-5 w-5 text-brand-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
                  <Badge tone={c.tone ?? "default"}>{c.chip}</Badge>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">{c.detail}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-300 transition-colors group-hover:text-brand-200">
                  Abrir
                  <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
