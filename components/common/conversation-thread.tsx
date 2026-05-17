"use client";

import { motion } from "framer-motion";
import { Bot, Check, CheckCheck, Sparkles } from "lucide-react";
import { ChatTurn } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function ConversationThread({
  turns,
  sender,
}: {
  turns: ChatTurn[];
  sender: string;
}) {
  return (
    <div className="space-y-3">
      {turns.map((t, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: idx * 0.04 }}
          className={cn(
            "flex w-full gap-2",
            t.from === "user" ? "justify-end" : "justify-start",
          )}
        >
          {t.from === "ai" && (
            <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ai-400/30 bg-ai-500/15">
              <Sparkles className="h-3.5 w-3.5 text-ai-400" />
            </div>
          )}
          <div
            className={cn(
              "relative max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-soft",
              t.from === "user"
                ? "rounded-tr-sm bg-success-500/10 text-ink ring-1 ring-success-500/20"
                : "rounded-tl-sm bg-ai-500/[0.08] text-ink ring-1 ring-ai-400/20",
            )}
          >
            {t.from === "ai" && (
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ai-400">
                <Bot className="h-3 w-3" /> Copiloto IA
              </div>
            )}
            <p className="text-ink">{t.text}</p>
            <div
              className={cn(
                "mt-1 flex items-center gap-1 text-[10px]",
                t.from === "user" ? "justify-end text-success-400/80" : "text-ink-subtle",
              )}
            >
              <span>{t.time}</span>
              {t.from === "user" && <CheckCheck className="h-3 w-3" />}
            </div>
          </div>
          {t.from === "user" && (
            <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-400/30 to-brand-600/30 text-[10px] font-semibold text-brand-200">
              {sender
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
