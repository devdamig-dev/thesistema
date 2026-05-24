import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Button } from "./button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  whatsappExample,
  ctaLabel,
  ctaHref,
  ctaAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  whatsappExample?: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaAction?: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-4 rounded-2xl border border-dashed border-line p-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-bg-subtle">
        <Icon className="h-5 w-5 text-brand-400" />
      </div>
      <h3 className="text-balance text-base font-semibold tracking-tight text-ink">
        {title}
      </h3>
      <p className="text-sm text-ink-muted leading-relaxed">{description}</p>
      {whatsappExample && (
        <div className="w-full rounded-xl border border-success-500/20 bg-success-500/[0.04] p-3 text-left">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-success-400">
            Ejemplo de mensaje WhatsApp
          </div>
          <p className="text-xs text-ink leading-relaxed italic">
            &ldquo;{whatsappExample}&rdquo;
          </p>
        </div>
      )}
      {ctaLabel && ctaHref && (
        <Link href={ctaHref}>
          <Button variant="primary" size="md">
            {ctaLabel}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      )}
      {ctaLabel && ctaAction && (
        <Button variant="primary" size="md" onClick={ctaAction}>
          {ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
