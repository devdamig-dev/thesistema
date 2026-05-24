/**
 * Tipos y constantes de notificaciones — importables desde client.
 *
 * Mantenemos esto separado de notifications.ts (que importa
 * createSupabaseServerClient y por ende `next/headers`) para que los
 * componentes client puedan usar tipos sin arrastrar dependencias
 * server-only.
 */

export type NotificationTone = "info" | "success" | "warn" | "danger" | "ai";
export type NotificationPriority = "high" | "medium" | "low" | "info";
export type NotificationCategory =
  | "operation"
  | "ai"
  | "stock"
  | "debt"
  | "invoice"
  | "employee"
  | "marketing"
  | "system";

export type Notification = {
  id: string;
  tone: NotificationTone;
  priority: NotificationPriority;
  category: NotificationCategory;
  title: string;
  detail: string | null;
  href: string | null;
  source: string | null;
  read: boolean;
  archived: boolean;
  createdAt: string;
};

export const PRIORITY_LABELS: Record<NotificationPriority, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
  info: "Informativa",
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  operation: "Operación",
  ai: "IA",
  stock: "Stock",
  debt: "Deudas",
  invoice: "Facturas",
  employee: "Empleados",
  marketing: "Marketing",
  system: "Sistema",
};
