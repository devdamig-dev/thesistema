"use client";

import { type ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { EMPTY_STATES, type EmptyStateConfig } from "@/lib/empty-states";

/**
 * Wrapper que muestra EmptyState si `data` está vacío.
 * Acepta un key de EMPTY_STATES o una config custom.
 */
export function DataOrEmpty({
  data,
  moduleKey,
  config,
  children,
}: {
  data: unknown[] | null | undefined;
  moduleKey?: string;
  config?: EmptyStateConfig;
  children: ReactNode;
}) {
  if (data && data.length > 0) {
    return <>{children}</>;
  }

  const es = config ?? (moduleKey ? EMPTY_STATES[moduleKey] : null);
  if (!es) return <>{children}</>;

  return (
    <div className="py-12">
      <EmptyState
        icon={es.icon}
        title={es.title}
        description={es.description}
        whatsappExample={es.whatsappExample}
        ctaLabel={es.ctaLabel}
        ctaHref={es.ctaHref}
      />
    </div>
  );
}
