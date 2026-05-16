"use client";

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";

export function KpiCard({
  label,
  value,
  delta,
  icon,
  tone = "default",
  hint,
  delay = 0,
}: {
  label: string;
  value: string;
  delta?: number;
  icon?: ReactNode;
  tone?: "default" | "brand" | "ai" | "success" | "danger" | "warn";
  hint?: string;
  delay?: number;
}) {
  const positive = delta !== undefined && delta >= 0;
  const neutral = delta === undefined || delta === 0;

  const accent = {
    default: "from-white/5 to-transparent",
    brand: "from-brand-500/15 to-transparent",
    ai: "from-ai-500/15 to-transparent",
    success: "from-success-500/15 to-transparent",
    danger: "from-danger-500/15 to-transparent",
    warn: "from-warn-500/15 to-transparent",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="card relative overflow-hidden p-5"
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80",
          accent,
        )}
      />
      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-muted">
            {icon && <span className="grid h-3.5 w-3.5 place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
            {label}
          </div>
          <div className="text-2xl font-semibold tracking-tight text-ink md:text-[1.75rem]">
            {value}
          </div>
          {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
        </div>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-medium",
              neutral
                ? "border-line bg-bg-subtle text-ink-muted"
                : positive
                  ? "border-success-500/30 bg-success-500/10 text-success-400"
                  : "border-danger-500/30 bg-danger-500/10 text-danger-400",
            )}
          >
            {neutral ? (
              <Minus className="h-3 w-3" />
            ) : positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {formatPercent(Math.abs(delta))}
          </span>
        )}
      </div>
    </motion.div>
  );
}
