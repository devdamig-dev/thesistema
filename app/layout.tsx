import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { DeniedToast } from "@/components/shell/denied-toast";
import { getCurrentUserContext } from "@/lib/data/auth";
import { getRecentNotifications } from "@/lib/data/notifications";
import { checkInternalAdmin } from "@/lib/admin/auth";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GastroPilot AI — Administración gastronómica con IA",
  description:
    "Administrá tu negocio gastronómico desde WhatsApp. La IA ordena tus ventas, compras, gastos, stock, empleados y reportes en tiempo real.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentUserContext();
  const databaseMode = isDatabaseMode();

  // En database mode una request anónima (por ejemplo /login) no debe tocar
  // tablas protegidas por RLS. Demo mode conserva sus notificaciones de ejemplo.
  const notifications =
    databaseMode && !ctx.isAuthenticated
      ? []
      : await getRecentNotifications(10);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const internalAdmin = await checkInternalAdmin();
  const showInternalAdmin = internalAdmin.allowed;

  let businessName: string | null = null;
  let branchName: string | null = null;
  let whatsappConnected = false;

  if (databaseMode && ctx.isAuthenticated && ctx.businessId) {
    const supabase = createSupabaseServerClient();
    const db = supabase as any;

    if (db) {
      const [businessRes, branchRes] = await Promise.all([
        db
          .from("businesses")
          .select("name, whatsapp_connected")
          .eq("id", ctx.businessId)
          .maybeSingle(),
        db
          .from("branches")
          .select("name")
          .eq("business_id", ctx.businessId)
          .eq("is_main", true)
          .maybeSingle(),
      ]);

      if (!businessRes.error) {
        businessName = businessRes.data?.name ?? null;
        whatsappConnected = Boolean(businessRes.data?.whatsapp_connected);
      }
      if (!branchRes.error) {
        branchName = branchRes.data?.name ?? null;
      }
    }
  }

  return (
    <html lang="es" className={`${inter.variable} dark`}>
      <body className="font-sans">
        <ToastProvider>
          <Suspense fallback={null}>
            <DeniedToast />
          </Suspense>
          <AppShell
            role={ctx.role}
            enabledModules={ctx.enabledModules}
            notifications={notifications}
            unreadCount={unreadCount}
            showInternalAdmin={showInternalAdmin}
            databaseMode={databaseMode}
            isAuthenticated={ctx.isAuthenticated}
            userName={ctx.fullName}
            userEmail={ctx.email}
            businessName={businessName}
            branchName={branchName}
            whatsappConnected={whatsappConnected}
          >
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
