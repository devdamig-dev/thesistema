"use client";

import { cn } from "@/lib/utils";

export function Sparkline({
  data,
  className,
  tone = "brand",
  height = 32,
}: {
  data: number[];
  className?: string;
  tone?: "brand" | "ai" | "success" | "danger";
  height?: number;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = height;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(" ");

  const stroke = {
    brand: "#F97316",
    ai: "#A78BFA",
    success: "#84CC16",
    danger: "#EF4444",
  }[tone];
  const fill = {
    brand: "rgba(249,115,22,0.18)",
    ai: "rgba(167,139,250,0.18)",
    success: "rgba(132,204,22,0.18)",
    danger: "rgba(239,68,68,0.18)",
  }[tone];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`sparkfill-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <polyline
        fill={`url(#sparkfill-${tone})`}
        stroke="none"
        points={`0,${h} ${points} ${w},${h}`}
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
