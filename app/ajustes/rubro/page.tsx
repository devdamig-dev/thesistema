"use client";

import { useState } from "react";
import {
  Beef,
  Beer,
  Check,
  Coffee,
  Cookie,
  IceCream,
  Pizza,
  Sparkles,
  Truck,
  UtensilsCrossed,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { SettingsCard } from "@/components/ajustes/setting-row";
import { cn } from "@/lib/utils";

type Industry =
  | "hamburgueseria"
  | "foodtruck"
  | "cafeteria"
  | "pizzeria"
  | "bar"
  | "heladeria"
  | "panaderia"
  | "restaurante"
  | "dark_kitchen";

const INDUSTRIES: { key: Industry; label: string; icon: any; tagline: string }[] = [
  { key: "hamburgueseria", label: "Hamburguesería", icon: Beef, tagline: "Recetas y food cost por producto" },
  { key: "foodtruck", label: "Foodtruck", icon: Truck, tagline: "Cierres por punto y caja viva" },
  { key: "cafeteria", label: "Cafetería", icon: Coffee, tagline: "Producción y combos desayuno" },
  { key: "pizzeria", label: "Pizzería", icon: Pizza, tagline: "Recetas por porción y delivery" },
  { key: "bar", label: "Bar", icon: Beer, tagline: "Stock de bebidas y happy hour" },
  { key: "heladeria", label: "Heladería", icon: IceCream, tagline: "Producción diaria y merma" },
  { key: "panaderia", label: "Panadería", icon: Cookie, tagline: "Recetas por lote y vencimientos" },
  { key: "restaurante", label: "Restaurante", icon: UtensilsCrossed, tagline: "Carta amplia y reservas" },
  { key: "dark_kitchen", label: "Dark kitchen", icon: Warehouse, tagline: "Multimarca y delivery only" },
];

const MODULES_BY_INDUSTRY: Record<Industry, { label: string; desc: string; tone: "brand" | "ai" | "success" }[]> = {
  hamburgueseria: [
    { label: "Recetas y food cost", desc: "Costos por producto y simulador de margen.", tone: "brand" },
    { label: "Stock cocina", desc: "Carne, pan, cheddar, bacon, papas, descartables.", tone: "ai" },
    { label: "Delivery propio + apps", desc: "Comparativa de canales y comisiones.", tone: "success" },
    { label: "Cierres diarios", desc: "Por turno y por canal.", tone: "brand" },
  ],
  foodtruck: [
    { label: "Cierres por punto", desc: "Cada ubicación con su caja y stock.", tone: "brand" },
    { label: "Caja viva", desc: "Efectivo, QR, tarjeta y retiros minuto a minuto.", tone: "ai" },
    { label: "Combustible y traslados", desc: "Costos variables del recorrido.", tone: "success" },
    { label: "Stock móvil", desc: "Lo que cargás antes de salir vs lo vendido.", tone: "brand" },
  ],
  cafeteria: [
    { label: "Producción diaria", desc: "Medialunas, sándwiches, masas frescas.", tone: "brand" },
    { label: "Combos de desayuno", desc: "Por turno y por estacionalidad.", tone: "ai" },
    { label: "Merma", desc: "Lo que no se vendió antes de cerrar.", tone: "success" },
    { label: "Clientes frecuentes", desc: "Quiénes vienen 3+ veces por semana.", tone: "brand" },
  ],
  pizzeria: [
    { label: "Recetas por porción", desc: "Costo por molde y por porción individual.", tone: "brand" },
    { label: "Delivery propio + apps", desc: "Tiempos y comisiones por canal.", tone: "ai" },
    { label: "Stock cocina + bebidas", desc: "Harina, queso, fiambres, gaseosas, vinos.", tone: "success" },
    { label: "Promociones por día", desc: "Lunes/jueves pizza libre.", tone: "brand" },
  ],
  bar: [
    { label: "Stock de bebidas", desc: "Cerveza, vino, destilados con su cobertura.", tone: "brand" },
    { label: "Recetas de tragos", desc: "Costos por copa o por jarra.", tone: "ai" },
    { label: "Happy hour", desc: "Promos por franja horaria y por canal.", tone: "success" },
    { label: "Consumo por turno", desc: "Mozos, barra, cocina.", tone: "brand" },
  ],
  heladeria: [
    { label: "Producción diaria", desc: "Sabores producidos vs sabores vendidos.", tone: "brand" },
    { label: "Merma", desc: "Pérdida por temperatura o vencimiento.", tone: "ai" },
    { label: "Estacionalidad", desc: "Curva de venta por sabor y por mes.", tone: "success" },
    { label: "Combos familiares", desc: "Kilos, medios kilos y postres.", tone: "brand" },
  ],
  panaderia: [
    { label: "Producción por lote", desc: "Cuántos kg de masa, cuántas piezas, qué rinde.", tone: "brand" },
    { label: "Vencimientos", desc: "Productos que vencen en menos de 24 hs.", tone: "ai" },
    { label: "Merma", desc: "Pan no vendido, harina perdida, devoluciones.", tone: "success" },
    { label: "Recetas por lote", desc: "Escalado de costos según producción.", tone: "brand" },
  ],
  restaurante: [
    { label: "Carta amplia", desc: "Entradas, principales, postres con receta.", tone: "brand" },
    { label: "Reservas", desc: "Mesas, cubiertos, ocupación por turno.", tone: "ai" },
    { label: "Mozos y propinas", desc: "Asignaciones y reparto.", tone: "success" },
    { label: "Bodega", desc: "Stock de vinos y rotación.", tone: "brand" },
  ],
  dark_kitchen: [
    { label: "Multimarca", desc: "Una cocina, varias marcas en apps.", tone: "brand" },
    { label: "Delivery only", desc: "Sin salón ni cierres por mesa.", tone: "ai" },
    { label: "Comisiones por app", desc: "Comparativa de rentabilidad por marca.", tone: "success" },
    { label: "Picking y packaging", desc: "Tiempos por pedido y errores.", tone: "brand" },
  ],
};

export default function AjustesRubroPage() {
  const [industry, setIndustry] = useState<Industry>("hamburgueseria");
  const { toast } = useToast();

  const suggested = MODULES_BY_INDUSTRY[industry];
  const current = INDUSTRIES.find((i) => i.key === industry)!;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Rubro gastronómico"
        description="GastroPilot adapta los módulos visibles, los reportes y los recomendadores según tu rubro."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
          {INDUSTRIES.map((i) => {
            const Icon = i.icon;
            const active = i.key === industry;
            return (
              <button
                key={i.key}
                onClick={() => setIndustry(i.key)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-3 text-left transition-all",
                  active
                    ? "border-brand-500/40 bg-brand-500/[0.06]"
                    : "border-line bg-bg-subtle/40 hover:border-line-strong hover:bg-bg-subtle",
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <div
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border",
                    active
                      ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                      : "border-line bg-bg-elevated text-ink-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm font-semibold text-ink">{i.label}</div>
                <div className="text-[11px] text-ink-muted leading-snug">{i.tagline}</div>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={`Módulos sugeridos para ${current.label}`}
        description="Estos módulos se activan o se priorizan automáticamente según el rubro elegido."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                toast({
                  tone: "neutral",
                  title: "Vista previa restablecida",
                })
              }
            >
              Restablecer
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast({
                  tone: "success",
                  title: `Rubro actualizado a ${current.label}`,
                  description: "Re-acomodamos el sidebar y las recomendaciones de la IA.",
                })
              }
            >
              <Check className="h-3.5 w-3.5" /> Aplicar rubro
            </Button>
          </>
        }
      >
        <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-ai-400/30 bg-ai-500/10 px-2.5 py-1 text-[11px] text-ai-400">
          <Sparkles className="h-3 w-3" />
          La IA recomienda activar estos módulos en base a {current.label.toLowerCase()}
        </div>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {suggested.map((m) => (
            <li
              key={m.label}
              className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
            >
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-bg-elevated">
                <Sparkles className="h-3.5 w-3.5 text-ai-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{m.label}</span>
                  <Badge tone={m.tone}>Sugerido</Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-muted leading-relaxed">
                  {m.desc}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>

    </div>
  );
}
