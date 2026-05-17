"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { cn } from "@/lib/utils";

type Priority = "alta" | "media" | "baja";

export function AttentionItem({
  priority,
  title,
  detail,
  cta,
  href,
  tag,
  delay = 0,
}: {
  priority: Priority;
  title: string;
  detail: string;
  cta: string;
  href: string;
  tag: string;
  delay?: number;
}) {
  const accent = {
    alta: "before:bg-danger-500",
    media: "before:bg-warn-500",
    baja: "before:bg-ai-500",
  }[priority];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "card group relative overflow-hidden p-4 transition-colors hover:bg-bg-elevated",
        "before:absolute before:left-0 before:top-3 before:h-[calc(100%-1.5rem)] before:w-[3px] before:rounded-r",
        accent,
      )}
    >
      <div className="flex items-start gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={priority} />
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
              · {tag}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-ink leading-snug">{title}</h3>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">{detail}</p>
        </div>
      </div>
      <Link
        href={href}
        className="mt-3 ml-2 inline-flex items-center gap-1 text-xs font-medium text-brand-300 transition-colors group-hover:text-brand-200"
      >
        {cta}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  );
}
