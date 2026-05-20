"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Building2,
  ChefHat,
  LucideIcon,
  MessageSquareText,
  Settings,
  Users,
} from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon; description: string }[] = [
  { href: "/ajustes", label: "Resumen", icon: Settings, description: "Vista general de la configuración" },
  { href: "/ajustes/negocio", label: "Negocio", icon: Building2, description: "Datos, sucursales y canales" },
  { href: "/ajustes/rubro", label: "Rubro", icon: ChefHat, description: "Adaptá los módulos a tu rubro" },
  { href: "/ajustes/whatsapp", label: "WhatsApp", icon: MessageSquareText, description: "Conexión y números autorizados" },
  { href: "/ajustes/ia", label: "Preferencias de IA", icon: Bot, description: "Tono, créditos y automatizaciones" },
  { href: "/ajustes/equipo", label: "Equipo y roles", icon: Users, description: "Usuarios, permisos y contador" },
];

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-1">
        <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
          Ajustes
        </div>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active =
            n.href === "/ajustes"
              ? pathname === "/ajustes"
              : pathname === n.href || pathname.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
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
                  active ? "text-brand-400" : "text-ink-subtle group-hover:text-ink-muted",
                )}
              />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
