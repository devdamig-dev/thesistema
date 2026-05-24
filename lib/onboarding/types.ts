export type OnboardingStep =
  | "business"
  | "branches"
  | "channels"
  | "team"
  | "whatsapp"
  | "recipes"
  | "finish";

export const STEPS: { key: OnboardingStep; label: string; description: string }[] = [
  { key: "business", label: "Tu negocio", description: "Nombre, rubro y datos fiscales" },
  { key: "branches", label: "Puntos de venta", description: "Locales, foodtrucks o dark kitchens" },
  { key: "channels", label: "Canales de venta", description: "Cómo vendés: salón, delivery, apps" },
  { key: "team", label: "Equipo", description: "Invitá socios, encargados y contador" },
  { key: "whatsapp", label: "WhatsApp", description: "Conectá el número del negocio" },
  { key: "recipes", label: "Ingredientes", description: "Los insumos base según tu rubro" },
  { key: "finish", label: "¡Listo!", description: "Todo configurado para arrancar" },
];

export type BranchType = "local" | "foodtruck" | "dark_kitchen" | "feria";

export const BRANCH_TYPES: { value: BranchType; label: string }[] = [
  { value: "local", label: "Local / Salón" },
  { value: "foodtruck", label: "Foodtruck" },
  { value: "dark_kitchen", label: "Dark kitchen" },
  { value: "feria", label: "Feria / Evento" },
];

export const SALE_CHANNELS = [
  { key: "salon", label: "Salón", hint: "Atención en el local" },
  { key: "whatsapp", label: "WhatsApp", hint: "Pedidos por mensaje" },
  { key: "delivery", label: "Delivery propio", hint: "Con tu propio delivery" },
  { key: "pedidos_ya", label: "PedidosYa", hint: "App de delivery" },
  { key: "rappi", label: "Rappi", hint: "App de delivery" },
  { key: "mp_qr", label: "QR Mercado Pago", hint: "Cobro con QR" },
  { key: "foodtruck_event", label: "Foodtruck / Eventos", hint: "Puntos rotativos" },
];
