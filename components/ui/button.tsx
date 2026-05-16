import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "ghost" | "ai" | "outline" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white shadow-soft hover:bg-brand-600 focus:ring-brand-500/40",
  ghost:
    "border border-line bg-bg-subtle text-ink hover:border-line-strong hover:bg-bg-elevated focus:ring-line-strong",
  ai: "bg-ai-600 text-white hover:bg-ai-500 focus:ring-ai-500/40",
  outline:
    "border border-line bg-transparent text-ink hover:bg-bg-subtle focus:ring-line-strong",
  subtle: "bg-bg-subtle text-ink-muted hover:text-ink focus:ring-line-strong",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
  icon: "h-9 w-9",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ className, variant = "ghost", size = "md", ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = "Button";
