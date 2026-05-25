/**
 * Configuraciones de EmptyState por módulo.
 *
 * Cada entry define el texto, CTA y ejemplo WhatsApp que se muestra
 * cuando una página no tiene datos (piloto recién arrancado o DB vacía).
 */

import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardList,
  FileText,
  Inbox,
  ShoppingCart,
  Users,
  UserSquare2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type EmptyStateConfig = {
  icon: LucideIcon;
  title: string;
  description: string;
  whatsappExample?: string;
  ctaLabel: string;
  ctaHref: string;
};

export const EMPTY_STATES: Record<string, EmptyStateConfig> = {
  inbox: {
    icon: Inbox,
    title: "Tu Inbox está esperando el primer mensaje",
    description:
      "Cuando tu equipo mande un mensaje por WhatsApp (texto, foto o audio), la IA lo convierte en un registro y aparece acá listo para aprobar.",
    whatsappExample: "Compramos 20kg de carne a Don José por 180mil. Pagamos transferencia.",
    ctaLabel: "Configurar WhatsApp",
    ctaHref: "/ajustes/whatsapp",
  },
  facturas: {
    icon: FileText,
    title: "Subí tu primera factura",
    description:
      "Mandá una foto o PDF por WhatsApp o subila desde acá. La IA lee proveedor, items, IVA y total, y lo cruza con tus insumos automáticamente.",
    whatsappExample: "[Foto de una factura de proveedor]",
    ctaLabel: "Subir factura",
    ctaHref: "/facturas",
  },
  ventas: {
    icon: BarChart3,
    title: "Todavía no hay ventas registradas",
    description:
      "Las ventas se cargan desde WhatsApp o desde los cierres diarios. Una vez aprobadas, aparecen acá con detalle por canal.",
    whatsappExample: "Hoy vendimos $850.000: local $500.000, delivery $250.000 y WhatsApp $100.000",
    ctaLabel: "Ir al Inbox IA",
    ctaHref: "/inbox",
  },
  stock: {
    icon: Boxes,
    title: "Stock vacío · cargá tus primeros insumos",
    description:
      "Los insumos se cargan desde el onboarding, desde facturas aprobadas, o manualmente. Después la IA avisa cuando algo baja del mínimo.",
    whatsappExample: "Quedan 8kg de cheddar",
    ctaLabel: "Ir al Onboarding",
    ctaHref: "/onboarding",
  },
  productos: {
    icon: ChefHat,
    title: "Armá tu carta con productos y recetas",
    description:
      "Cargá tus hamburguesas, combos, bebidas o lo que vendas. La IA calcula el margen y avisa si algo baja de rentabilidad.",
    ctaLabel: "Ir al Onboarding",
    ctaHref: "/onboarding",
  },
  empleados: {
    icon: Users,
    title: "Agregá a tu equipo",
    description:
      "Cargá empleados con su rol, turno y costo. La IA cruza el costo laboral con las ventas y detecta turnos ineficientes.",
    ctaLabel: "Agregar empleado",
    ctaHref: "/empleados",
  },
  clientes: {
    icon: UserSquare2,
    title: "Tus clientes aparecen cuando empiezan a comprar",
    description:
      "Se cargan automáticamente desde ventas por WhatsApp y delivery. También podés cargarlos manualmente.",
    ctaLabel: "Ir a Marketing IA",
    ctaHref: "/marketing",
  },
  cierres: {
    icon: ClipboardList,
    title: "Esperando el primer cierre del día",
    description:
      "Tu equipo manda el cierre por WhatsApp en texto libre y la IA lo estructura: efectivo, tarjeta, QR, gastos, retiros, productos vendidos.",
    whatsappExample:
      "CARRO foodtruck 16/05\nEFECTIVO: $290.000\nTARJETA: $225.000\nQR: $178.000\nTOTAL: $693.000",
    ctaLabel: "Configurar WhatsApp",
    ctaHref: "/ajustes/whatsapp",
  },
  compras: {
    icon: ShoppingCart,
    title: "Las compras se registran desde el Inbox o las facturas",
    description:
      "Mandá por WhatsApp qué compraste, a quién y cuánto. O subí la factura y la IA crea la compra automáticamente.",
    whatsappExample: "Compramos 10kg de queso cheddar a La Serenísima por $84.000",
    ctaLabel: "Ir al Inbox IA",
    ctaHref: "/inbox",
  },
};
