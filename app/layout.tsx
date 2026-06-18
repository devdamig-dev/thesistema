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
  // Fetch del contexto en el layout para que todas las páginas tengan
  // sidebar/topbar correctos. Si Supabase no está, todo cae a demo.
  const ctx = await getCurrentUserContext();
  const notifications = await getRecentNotifications(10);
  const unreadCount = notifications.filter((n) => !n.read).length;
  // Sólo agrega el grupo "Interno · GastroPilot" del sidebar cuando el
  // gate del módulo /admin pasa. Para clientes normales esto siempre
  // es false → el módulo no se filtra ni aparece en la nav.
  const internalAdmin = await checkInternalAdmin();
  const showInternalAdmin = internalAdmin.allowed;

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
          >
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
