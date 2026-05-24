"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Boxes,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HandCoins,
  Inbox,
  LayoutDashboard,
  LucideIcon,
  Megaphone,
  PieChart,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
  UserSquare2,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { businessInfo } from "@/lib/mock-data";
import { canSeeModule, getRoleLabel, type ModuleKey, type Role } from "@/lib/permissions";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  accent?: "ai" | "brand";
  module?: ModuleKey;            // si tiene, se filtra por permiso
  systemAlwaysVisible?: boolean; // ayuda + ajustes
};

type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, module: "dashboard" },
      { href: "/inbox", label: "Inbox IA", icon: Inbox, badge: "3", accent: "ai", module: "inbox_ai" },
      { href: "/reportes", label: "Reportes IA", icon: Sparkles, accent: "ai", module: "reports_ai" },
      { href: "/marketing", label: "Marketing IA", icon: Megaphone, badge: "Nuevo", accent: "ai", module: "marketing_ai" },
    ],
  },
  {
    label: "IA y documentos",
    items: [
      { href: "/facturas", label: "Facturas OCR", icon: FileText, badge: "OCR", accent: "ai", module: "invoices_ocr" },
      { href: "/cierres", label: "Cierres diarios", icon: ClipboardList, badge: "2", accent: "ai", module: "daily_closures" },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/ventas", label: "Ventas", icon: BarChart3, module: "sales" },
      { href: "/compras", label: "Compras", icon: ShoppingCart, module: "purchases" },
      { href: "/gastos", label: "Gastos fijos", icon: Receipt, module: "fixed_expenses" },
      { href: "/deudas", label: "Deudas", icon: HandCoins, module: "debts" },
      { href: "/stock", label: "Stock e insumos", icon: Boxes, module: "stock" },
      { href: "/productos", label: "Productos", icon: ChefHat, module: "products" },
      { href: "/balances", label: "Balances", icon: PieChart, module: "balances" },
    ],
  },
  {
    label: "Equipo",
    items: [
      { href: "/empleados", label: "Empleados", icon: Users, module: "employees" },
      { href: "/clientes", label: "Clientes", icon: UserSquare2, module: "customers" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/notificaciones", label: "Notificaciones", icon: Bell, systemAlwaysVisible: true },
      { href: "/auditoria", label: "Auditoría", icon: ClipboardCheck, systemAlwaysVisible: true },
      { href: "/ayuda", label: "Ayuda", icon: LifeBuoy, systemAlwaysVisible: true },
      { href: "/ajustes", label: "Ajustes", icon: Settings, systemAlwaysVisible: true },
    ],
  },
];

export function Sidebar({
  onNavigate,
  role,
  enabledModules,
  unreadCount,
}: {
  onNavigate?: () => void;
  role?: Role;
  enabledModules?: ModuleKey[] | null;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const effectiveRole: Role = role ?? "owner";

  // Filtrar items según permisos del rol + módulos habilitados.
  const filteredNav = NAV.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => {
        if (item.systemAlwaysVisible) return true;
        if (!item.module) return true;
        return canSeeModule(effectiveRole, item.module, enabledModules ?? null);
      })
      .map((item) => {
        // Inject dynamic unread badge en la entrada de Notificaciones
        if (item.href === "/notificaciones" && (unreadCount ?? 0) > 0) {
          return {
            ...item,
            badge: unreadCount! > 9 ? "9+" : String(unreadCount),
            accent: "brand" as const,
          };
        }
        return item;
      }),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-line bg-bg-subtle/70 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent" />
      <Brand />
      <nav className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        {filteredNav.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-bg-elevated text-ink"
                          : "text-ink-muted hover:bg-bg-elevated/60 hover:text-ink",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand-500" />
                      )}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active
                            ? item.accent === "ai"
                              ? "text-ai-400"
                              : "text-brand-400"
                            : "text-ink-subtle group-hover:text-ink-muted",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            item.accent === "ai"
                              ? "border-ai-400/30 bg-ai-500/10 text-ai-400"
                              : "border-brand-500/30 bg-brand-500/10 text-brand-300",
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Footer role={effectiveRole} />
    </aside>
  );
}

function Brand() {
  return (
    <div className="border-b border-line px-4 py-4">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-soft">
          <span className="text-base font-black text-white">G</span>
          <span className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent" />
        </div>
        <div className="leading-tight">
          <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
            GastroPilot
            <span className="rounded-md bg-ai-500/15 px-1.5 py-0.5 text-[10px] font-bold text-ai-400">
              AI
            </span>
          </div>
          <div className="text-[11px] text-ink-subtle">{businessInfo.name}</div>
        </div>
      </Link>
    </div>
  );
}

function Footer({ role }: { role: Role }) {
  return (
    <div className="space-y-3 border-t border-line px-3 py-3">
      <Link
        href="/ajustes/ia"
        className="group block rounded-xl border border-ai-400/25 bg-gradient-to-br from-ai-500/[0.08] via-bg-elevated/40 to-bg-elevated/40 p-3 transition-colors hover:border-ai-400/50"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ai-400">
          <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-ai-400" />
          Plan {businessInfo.plan}
        </div>
        <p className="text-xs leading-relaxed text-ink">
          Estás usando 64% de los créditos IA del mes.
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-subtle">
          <div className="h-full w-[64%] rounded-full bg-gradient-to-r from-ai-400 to-ai-600" />
        </div>
      </Link>

      <Link
        href="/ajustes"
        className="flex items-center gap-3 rounded-lg border border-line bg-bg-elevated/60 p-2.5 transition-colors hover:border-line-strong"
      >
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white">
          MI
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-medium text-ink">{businessInfo.owner}</div>
          <div className="truncate text-[10px] text-ink-subtle">
            {getRoleLabel(role)} · {businessInfo.location}
          </div>
        </div>
      </Link>
    </div>
  );
}
