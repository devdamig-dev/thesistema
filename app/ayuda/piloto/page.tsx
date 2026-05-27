import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChefHat,
  FileText,
  Inbox,
  MessageSquareText,
  Rocket,
  Settings,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: Settings,
    title: "1. Configurar el negocio",
    detail: "Completar el onboarding: nombre, rubro, sucursales y canales de venta.",
    href: "/onboarding",
    cta: "Ir al Onboarding",
    done: false,
  },
  {
    icon: MessageSquareText,
    title: "2. Conectar WhatsApp",
    detail: "Asignar un número de WhatsApp Business dedicado. Registrar el webhook en Meta o probar con curl.",
    href: "/ajustes/whatsapp",
    cta: "Configurar WhatsApp",
    done: false,
  },
  {
    icon: UserPlus,
    title: "3. Invitar al equipo",
    detail: "Agregar socios, encargados y el contador con su rol y permisos correspondientes.",
    href: "/ajustes/equipo",
    cta: "Invitar usuarios",
    done: false,
  },
  {
    icon: ChefHat,
    title: "4. Cargar ingredientes y productos",
    detail: "Si el onboarding no seedeó lo que necesitás, cargá ingredientes y armá productos con recetas.",
    href: "/productos",
    cta: "Ir a Productos",
    done: false,
  },
  {
    icon: Inbox,
    title: "5. Probar el Inbox IA",
    detail: 'Mandá un mensaje de prueba: "Compramos 20kg de carne a Don José por 180mil". Debería aparecer en el Inbox listo para aprobar.',
    href: "/inbox",
    cta: "Abrir Inbox",
    done: false,
  },
  {
    icon: FileText,
    title: "6. Subir la primera factura",
    detail: "Foto o PDF de un proveedor. La IA extrae items, matchea con insumos y queda lista para aprobar.",
    href: "/facturas",
    cta: "Ir a Facturas",
    done: false,
  },
  {
    icon: Sparkles,
    title: "7. Revisar reportes y recomendaciones",
    detail: "El Dashboard muestra KPIs en tiempo real. Reportes IA responde preguntas. Marketing IA sugiere campañas.",
    href: "/reportes",
    cta: "Abrir Reportes",
    done: false,
  },
  {
    icon: BookOpen,
    title: "8. Revisar auditoría y notificaciones",
    detail: "Cada acción queda logueada. Las notificaciones avisan de stock crítico, deudas vencidas y más.",
    href: "/auditoria",
    cta: "Ver Auditoría",
    done: false,
  },
];

export default function PilotoPage() {
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Ayuda · Guía de piloto"
        title="Arrancá tu piloto en 8 pasos."
        description="Seguí esta guía para configurar GastroPilot, probar las funcionalidades clave y empezar a operar con datos reales."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.title} className="overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-bg-subtle">
                    <Icon className="h-5 w-5 text-brand-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
                    <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                      {s.detail}
                    </p>
                    <Link href={s.href} className="mt-3 inline-block">
                      <Button variant="ghost" size="sm">
                        {s.cta}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-brand-500/10 via-ai-500/[0.06] to-transparent p-6">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-brand-400" />
            <h3 className="text-base font-semibold text-ink">¿Necesitás ayuda?</h3>
          </div>
          <p className="mt-2 max-w-lg text-sm text-ink-muted">
            Si tenés dudas durante el piloto, usá el{" "}
            <Link href="/reportes" className="font-medium text-ai-400 hover:text-ai-300">
              Copiloto IA
            </Link>{" "}
            para preguntar sobre tu negocio, o escribinos al{" "}
            <Link href="/ayuda" className="font-medium text-brand-300 hover:text-brand-200">
              Centro de Ayuda
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
