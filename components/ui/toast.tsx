"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  X,
} from "lucide-react";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "info" | "warn" | "ai" | "neutral";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
};

type ToastInput = Omit<Toast, "id">;

type Ctx = {
  toast: (t: ToastInput) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<Ctx | null>(null);

const TONE_STYLES: Record<ToastTone, { ring: string; icon: ReactNode; accent: string }> = {
  success: {
    ring: "border-success-500/40 bg-success-500/[0.08]",
    icon: <CheckCircle2 className="h-4 w-4 text-success-400" />,
    accent: "bg-success-500",
  },
  info: {
    ring: "border-ai-400/40 bg-ai-500/[0.08]",
    icon: <Info className="h-4 w-4 text-ai-400" />,
    accent: "bg-ai-500",
  },
  warn: {
    ring: "border-warn-500/40 bg-warn-500/[0.08]",
    icon: <AlertTriangle className="h-4 w-4 text-warn-400" />,
    accent: "bg-warn-500",
  },
  ai: {
    ring: "border-ai-400/40 bg-ai-500/[0.08]",
    icon: <Sparkles className="h-4 w-4 text-ai-400" />,
    accent: "bg-ai-500",
  },
  neutral: {
    ring: "border-line bg-bg-elevated",
    icon: <Info className="h-4 w-4 text-ink-muted" />,
    accent: "bg-ink-subtle",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((t: ToastInput) => {
    const id = `t-${++counter.current}`;
    const item: Toast = { id, duration: 3800, tone: "success", ...t };
    setToasts((current) => [...current, item]);
    if (item.duration && item.duration > 0) {
      setTimeout(() => dismiss(id), item.duration);
    }
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toaster({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:justify-end">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const tone = TONE_STYLES[t.tone ?? "success"];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.96 }}
                transition={{ type: "spring", damping: 24, stiffness: 280 }}
                className={cn(
                  "pointer-events-auto relative overflow-hidden rounded-xl border p-3 pl-4 shadow-soft backdrop-blur-xl",
                  tone.ring,
                )}
              >
                <span className={cn("absolute inset-y-0 left-0 w-0.5", tone.accent)} />
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">{tone.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink leading-snug">
                      {t.title}
                    </p>
                    {t.description && (
                      <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
                        {t.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss(t.id)}
                    className="shrink-0 rounded-md p-0.5 text-ink-subtle hover:text-ink"
                    aria-label="Cerrar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Allow usage even if provider isn't mounted yet — silent noop fallback.
    return {
      toast: () => {},
      dismiss: () => {},
    } as Ctx;
  }
  return ctx;
}

// Toast presets for common product states.
export const ToastPresets = {
  approved: (what = "Registro"): ToastInput => ({
    tone: "success",
    title: `${what} aprobado`,
    description: "Quedó disponible en los reportes en tiempo real.",
  }),
  needsDataRequested: (): ToastInput => ({
    tone: "info",
    title: "Pedimos el dato faltante por WhatsApp",
    description: "Te avisamos cuando el equipo responda.",
  }),
  dismissed: (what = "Registro"): ToastInput => ({
    tone: "neutral",
    title: `${what} descartado`,
    description: "Lo movimos al historial. Podés recuperarlo en cualquier momento.",
  }),
  campaignGenerated: (): ToastInput => ({
    tone: "ai",
    title: "Campaña generada",
    description: "Lista para revisar y enviar desde Marketing IA.",
  }),
  campaignScheduled: (): ToastInput => ({
    tone: "info",
    title: "Campaña programada",
    description: "Se va a enviar en el horario óptimo detectado por la IA.",
  }),
  invoiceUploaded: (): ToastInput => ({
    tone: "ai",
    title: "Procesando factura con IA",
    description: "Tarda unos 8 segundos. Te avisamos cuando esté lista.",
  }),
  invoiceSentToAccountant: (): ToastInput => ({
    tone: "success",
    title: "Factura imputada al contador",
    description: "Se envió al estudio con todos los datos discriminados.",
  }),
  closureApproved: (): ToastInput => ({
    tone: "success",
    title: "Cierre aprobado",
    description: "Impactó en ventas, gastos y caja del día.",
  }),
  productUpdated: (): ToastInput => ({
    tone: "success",
    title: "Producto actualizado",
    description: "Recalculamos margen y aplicamos el nuevo precio.",
  }),
  settingsSaved: (): ToastInput => ({
    tone: "success",
    title: "Configuración guardada",
  }),
  comingSoon: (feature?: string): ToastInput => ({
    tone: "ai",
    title: feature ? `${feature} · próximamente` : "Próximamente disponible",
    description: "Esta acción se habilita con el backend en producción.",
  }),
  exported: (): ToastInput => ({
    tone: "success",
    title: "Exportación generada",
    description: "Te enviamos el archivo a tu correo.",
  }),
};
