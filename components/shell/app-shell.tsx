"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ModuleKey, Role } from "@/lib/permissions";
import type { Notification } from "@/lib/data/notifications-types";

const BARE_ROUTES = ["/login", "/onboarding"];

export type AppShellProps = {
  children: ReactNode;
  role: Role;
  enabledModules: ModuleKey[] | null;
  notifications: Notification[];
  unreadCount: number;
  showInternalAdmin?: boolean;
};

export function AppShell({
  children,
  role,
  enabledModules,
  notifications,
  unreadCount,
  showInternalAdmin = false,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Rutas sin sidebar/topbar (login, etc.)
  if (BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="relative flex min-h-screen">
      <div className="hidden w-64 shrink-0 md:block lg:w-72">
        <div className="sticky top-0 h-screen">
          <Sidebar
            role={role}
            enabledModules={enabledModules}
            unreadCount={unreadCount}
            showInternalAdmin={showInternalAdmin}
          />
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-72 md:hidden"
            >
              <Sidebar
                onNavigate={() => setMobileOpen(false)}
                role={role}
                enabledModules={enabledModules}
                unreadCount={unreadCount}
                showInternalAdmin={showInternalAdmin}
              />
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md border border-line bg-bg-subtle text-ink-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenNav={() => setMobileOpen(true)}
          notifications={notifications}
          unreadCount={unreadCount}
        />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
