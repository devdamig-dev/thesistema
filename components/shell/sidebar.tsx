"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ChefHat,
  Inbox,
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  UserSquare2,
  Settings,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { businessInfo } from "@/lib/mock-data";

const NAV = [
  {
    label: "General",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      {
        href: "/inbox",
        label: "Inbox IA",
        icon: Inbox,
        badge: "3",
        accent: "ai" as const,
      },
      { href: "/reportes", label: "Reportes IA", icon: Sparkles, accent: "ai" as const },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/ventas", label: "Ventas", icon: BarChart3 },
      { href: "/compras", label: "Compras", icon: ShoppingCart },
      { href: "/gastos", label: "Gastos fijos", icon: Receipt },
      { href: "/stock", label: "Stock e insumos", icon: Boxes },
      { href: "/productos", label: "Productos", icon: ChefHat },
    ],
  },
  {
    label: "Equipo",
    items: [
      { href: "/empleados", label: "Empleados", icon: Users },
      { href: "/clientes", label: "Clientes", icon: UserSquare2 },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-bg-subtle/60 backdrop-blur-xl">
      <Brand />
      <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
        {NAV.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
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
                      {"badge" in item && item.badge && (
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
      <Footer />
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

function Footer() {
  return (
    <div className="space-y-3 border-t border-line px-3 py-3">
      <div className="flex items-center justify-between px-2">
        <Link
          href="#"
          className="flex items-center gap-2 text-xs text-ink-muted hover:text-ink"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          Ayuda
        </Link>
        <Link
          href="#"
          className="flex items-center gap-2 text-xs text-ink-muted hover:text-ink"
        >
          <Settings className="h-3.5 w-3.5" />
          Ajustes
        </Link>
      </div>
      <Link
        href="#"
        className="flex items-center gap-3 rounded-lg border border-line bg-bg-elevated/60 p-2.5 transition-colors hover:border-line-strong"
      >
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white">
          MI
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-medium text-ink">{businessInfo.owner}</div>
          <div className="truncate text-[10px] text-ink-subtle">
            Plan {businessInfo.plan} · {businessInfo.location}
          </div>
        </div>
      </Link>
    </div>
  );
}
