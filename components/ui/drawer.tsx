"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className={`fixed inset-y-0 right-0 z-50 w-full ${width} border-l border-line bg-bg-elevated shadow-2xl`}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
                <div>
                  {title && (
                    <h2 className="text-base font-semibold tracking-tight text-ink">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-md border border-line bg-bg-subtle text-ink-muted hover:text-ink"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
