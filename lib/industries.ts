/**
 * Rubros gastronómicos y módulos sugeridos por rubro.
 *
 * Esta info la consume:
 *   - app/ajustes/rubro (selector visual de rubro).
 *   - components/shell/sidebar (filtra ítems según módulos activos).
 *   - lib/data/supabase (cuando cambia el rubro, recalcula los
 *     `business_modules.suggested`).
 */

import type { Industry, ModuleKey } from "@/lib/entities";

export type IndustryKey = Industry;

export const INDUSTRIES: { key: IndustryKey; label: string; tagline: string }[] = [
  { key: "hamburgueseria", label: "Hamburguesería",  tagline: "Recetas y food cost por producto" },
  { key: "foodtruck",      label: "Foodtruck",       tagline: "Cierres por punto y caja viva" },
  { key: "cafeteria",      label: "Cafetería",       tagline: "Producción y combos desayuno" },
  { key: "pizzeria",       label: "Pizzería",        tagline: "Recetas por porción y delivery" },
  { key: "bar",            label: "Bar",             tagline: "Stock de bebidas y happy hour" },
  { key: "heladeria",      label: "Heladería",       tagline: "Producción diaria y merma" },
  { key: "panaderia",      label: "Panadería",       tagline: "Recetas por lote y vencimientos" },
  { key: "restaurante",    label: "Restaurante",     tagline: "Carta amplia y reservas" },
  { key: "dark_kitchen",   label: "Dark kitchen",    tagline: "Multimarca y delivery only" },
];

/**
 * Módulos que cada rubro habilita por defecto. Cuando el usuario cambia
 * el rubro, marcamos estos como `suggested = true` en
 * `business_modules`.
 *
 * Los módulos no listados quedan disponibles pero no destacados.
 */
export const SUGGESTED_MODULES_BY_INDUSTRY: Record<IndustryKey, ModuleKey[]> = {
  hamburgueseria: [
    "products", "recipes", "food_cost", "stock", "deliveries",
    "daily_closures", "inbox_ai",
  ],
  foodtruck: [
    "daily_closures", "sales", "stock", "deliveries", "inbox_ai",
  ],
  cafeteria: [
    "production", "breakfast_combos", "waste", "frequent_customers",
    "products", "stock",
  ],
  pizzeria: [
    "products", "recipes", "food_cost", "deliveries", "stock",
    "daily_closures",
  ],
  bar: [
    "beverages_stock", "drink_recipes", "happy_hour",
    "shift_consumption", "stock",
  ],
  heladeria: [
    "production", "waste", "products", "stock", "daily_closures",
  ],
  panaderia: [
    "batch_recipes", "production", "expirations", "waste",
    "stock",
  ],
  restaurante: [
    "products", "recipes", "food_cost", "stock", "employees",
    "shifts", "customers",
  ],
  dark_kitchen: [
    "products", "deliveries", "stock", "food_cost",
  ],
};

/**
 * Descripciones cortas de cada módulo por rubro — esto es lo que
 * mostramos en /ajustes/rubro cuando el usuario elige un rubro.
 */
export const MODULE_LABELS: Partial<Record<ModuleKey, { label: string; desc: string }>> = {
  products:           { label: "Productos",            desc: "Carta con margen y rentabilidad." },
  recipes:            { label: "Recetas",              desc: "Ingredientes, cantidades y costos." },
  food_cost:          { label: "Food cost",            desc: "Costos por producto y simulador de margen." },
  stock:              { label: "Stock cocina",         desc: "Insumos, cobertura en días, reposición." },
  deliveries:         { label: "Delivery",             desc: "Propio + apps con comisiones por canal." },
  daily_closures:     { label: "Cierres diarios",      desc: "Por turno, canal y punto de venta." },
  inbox_ai:           { label: "Inbox IA",             desc: "WhatsApp como fuente de carga." },
  sales:              { label: "Caja viva",            desc: "Efectivo, QR, tarjeta y retiros del día." },
  production:         { label: "Producción diaria",    desc: "Lo que se hace cada día." },
  breakfast_combos:   { label: "Combos desayuno",      desc: "Promos por turno." },
  waste:              { label: "Merma",                desc: "Lo que no se vendió antes de cerrar." },
  frequent_customers: { label: "Clientes frecuentes",  desc: "Quiénes vienen 3+ veces por semana." },
  beverages_stock:    { label: "Stock de bebidas",     desc: "Cerveza, vino, destilados, cobertura." },
  drink_recipes:      { label: "Tragos / recetas",     desc: "Costos por copa o jarra." },
  happy_hour:         { label: "Happy hour",           desc: "Promos por franja horaria." },
  shift_consumption:  { label: "Consumo por turno",    desc: "Mozos, barra, cocina." },
  batch_recipes:      { label: "Recetas por lote",     desc: "Escalado de costos según producción." },
  expirations:        { label: "Vencimientos",         desc: "Productos que vencen en <24 hs." },
  employees:          { label: "Empleados",            desc: "Equipo, costos, adelantos." },
  shifts:             { label: "Turnos",               desc: "Planificación semanal." },
  customers:          { label: "Clientes",             desc: "Base con segmentación y campañas." },
};
