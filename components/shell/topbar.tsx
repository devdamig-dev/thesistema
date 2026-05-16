"use client";

import { Bell, Command, MessageSquareText, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Sidebar } from "./sidebar";

export function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:px-6">
      <button
        onClick={onOpenNav}
        className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted hover:text-ink md:hidden"
        aria-label="Abrir menú"
      >
        <span className="block h-0.5 w-4 bg-current shadow-[0_4px_0_currentColor,0_-4px_0_currentColor]" />
      </button>

      <div className="hidden flex-1 md:flex md:max-w-md">
        <div className="group flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 text-sm text-ink-muted transition-colors hover:border-line-strong">
          <Search className="h-4 w-4" />
          <input
            placeholder="Buscar movimientos, proveedores, productos…"
            className="flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="hidden items-center gap-1 rounded border border-line bg-bg-elevated px-1.5 py-0.5 text-[10px] text-ink-subtle md:inline-flex">
            <Command className="h-3 w-3" /> K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <AskAIPill />
        <button className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted hover:text-ink">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulseDot" />
        </button>
        <button className="hidden h-9 items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/10 px-2.5 text-xs font-medium text-success-400 md:inline-flex">
          <MessageSquareText className="h-3.5 w-3.5" />
          WhatsApp conectado
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-success-500 animate-pulseDot" />
        </button>
      </div>
    </header>
  );
}

function AskAIPill() {
  const [value, setValue] = useState("");
  return (
    <div className="hidden h-9 items-center gap-2 rounded-lg border border-ai-400/30 bg-ai-500/10 px-2.5 text-sm text-ai-400 md:inline-flex">
      <Sparkles className="h-3.5 w-3.5" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Preguntale a la IA…"
        className="w-44 bg-transparent text-xs placeholder:text-ai-400/70 focus:outline-none"
      />
    </div>
  );
}
