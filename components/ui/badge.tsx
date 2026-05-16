import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

type Tone = "default" | "brand" | "ai" | "success" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  default: "border-line bg-bg-subtle text-ink-muted",
  brand: "border-brand-500/30 bg-brand-500/10 text-brand-300",
  ai: "border-ai-400/30 bg-ai-500/10 text-ai-400",
  success: "border-success-500/30 bg-success-500/10 text-success-400",
  warn: "border-warn-500/30 bg-warn-500/10 text-warn-400",
  danger: "border-danger-500/30 bg-danger-500/10 text-danger-400",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

export function Badge({
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
