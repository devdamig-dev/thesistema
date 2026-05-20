"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card overflow-hidden", className)}>
      <header className="border-b border-line px-5 py-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        )}
      </header>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-line bg-bg-subtle/40 px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-line/60 py-3 last:border-0 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
      <div>
        <div className="text-sm text-ink">{label}</div>
        {hint && <div className="text-[11px] text-ink-subtle">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function TextField({
  defaultValue,
  placeholder,
  type = "text",
}: {
  defaultValue?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
}) {
  return (
    <input
      type={type}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none focus:ring-2 focus:ring-brand-500/20"
    />
  );
}

export function Toggle({
  defaultChecked = false,
  onChange,
}: {
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-bg-subtle ring-1 ring-line transition-colors peer-checked:bg-brand-500/40 peer-checked:ring-brand-500/60" />
      <span className="relative ml-0.5 h-5 w-5 rounded-full bg-ink-muted shadow-soft transition-all peer-checked:ml-[1.4rem] peer-checked:bg-brand-400" />
    </label>
  );
}
