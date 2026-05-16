"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  LucideIcon,
  PieChart,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  TrendingUp,
  CalendarDays,
  PieChart,
  Target,
  Sparkles,
};

type Tone = "info" | "warn" | "danger" | "success";

const TONE_STYLES: Record<Tone, { ring: string; dot: string; chip: string }> = {
  info: {
    ring: "border-ai-400/30",
    dot: "bg-ai-500",
    chip: "bg-ai-500/10 text-ai-400 border-ai-400/30",
  },
  warn: {
    ring: "border-warn-500/30",
    dot: "bg-warn-500",
    chip: "bg-warn-500/10 text-warn-400 border-warn-500/30",
  },
  danger: {
    ring: "border-danger-500/30",
    dot: "bg-danger-500",
    chip: "bg-danger-500/10 text-danger-400 border-danger-500/30",
  },
  success: {
    ring: "border-success-500/30",
    dot: "bg-success-500",
    chip: "bg-success-500/10 text-success-400 border-success-500/30",
  },
};

export function InsightCard({
  tone = "info",
  icon = "Sparkles",
  title,
  detail,
  delay = 0,
}: {
  tone?: Tone;
  icon?: string;
  title: string;
  detail: string;
  delay?: number;
}) {
  const Icon = ICONS[icon] ?? Sparkles;
  const styles = TONE_STYLES[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "card group relative overflow-hidden p-4 transition-colors hover:bg-bg-elevated",
        styles.ring,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg border",
            styles.chip,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                styles.chip,
              )}
            >
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
          </div>
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-1 text-xs text-ink-muted">{detail}</p>
        </div>
      </div>
    </motion.div>
  );
}
