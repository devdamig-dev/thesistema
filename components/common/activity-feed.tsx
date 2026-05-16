"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Mic,
  Image as ImageIcon,
  MessageSquareText,
  Receipt,
  Wallet,
  Sparkles,
} from "lucide-react";
import { recentActivity } from "@/lib/mock-data";
import { formatARS, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const TYPE_ICON = {
  compra: Receipt,
  venta: ArrowUpRight,
  adelanto: Wallet,
  stock: Boxes,
  gasto: ArrowDownLeft,
} as const;

const SOURCE_ICON = (src: string) =>
  src.includes("audio") ? Mic : src.includes("foto") ? ImageIcon : MessageSquareText;

export function ActivityFeed() {
  return (
    <ul className="space-y-1">
      {recentActivity.map((a) => {
        const Icon = TYPE_ICON[a.type as keyof typeof TYPE_ICON];
        const SourceIcon = SOURCE_ICON(a.source);
        const positive = a.amount > 0;
        return (
          <li
            key={a.id}
            className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-bg-subtle"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg-subtle">
              <Icon className="h-4 w-4 text-ink-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm text-ink">{a.text}</p>
                {a.status === "revision" && (
                  <Badge tone="warn">Revisión</Badge>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-ai-400" />
                  Detectado por IA
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <SourceIcon className="h-3 w-3" />
                  {a.source}
                </span>
                <span>·</span>
                <span>{relativeTime(a.at)}</span>
              </div>
            </div>
            {a.amount !== 0 && (
              <div
                className={`shrink-0 text-sm font-medium tabular-nums ${
                  positive ? "text-success-400" : "text-ink"
                }`}
              >
                {positive ? "+" : ""}
                {formatARS(a.amount)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
