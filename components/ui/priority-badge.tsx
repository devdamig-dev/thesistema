import { cn } from "@/lib/utils";

type Priority = "alta" | "media" | "baja";

const STYLES: Record<Priority, string> = {
  alta: "border-danger-500/30 bg-danger-500/10 text-danger-400",
  media: "border-warn-500/30 bg-warn-500/10 text-warn-400",
  baja: "border-ai-400/30 bg-ai-500/10 text-ai-400",
};

const DOT: Record<Priority, string> = {
  alta: "bg-danger-500",
  media: "bg-warn-500",
  baja: "bg-ai-500",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STYLES[priority],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[priority])} />
      Prioridad {priority}
    </span>
  );
}
