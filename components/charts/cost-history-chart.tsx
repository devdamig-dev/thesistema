"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatARS } from "@/lib/format";

export function CostHistoryChart({
  data,
  tone = "brand",
  height = 160,
}: {
  data: { fecha: string; precio: number }[];
  tone?: "brand" | "ai" | "danger";
  height?: number;
}) {
  const color = { brand: "#F97316", ai: "#A78BFA", danger: "#EF4444" }[tone];
  const id = `cost-${tone}`;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="fecha" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            tickFormatter={(v) => formatARS(v, { compact: true })}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: "rgba(249,115,22,0.3)" }}
            contentStyle={{
              background: "hsl(222 22% 8%)",
              border: "1px solid hsl(220 14% 18%)",
              borderRadius: 10,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            formatter={(v: number) => formatARS(v)}
          />
          <Area type="monotone" dataKey="precio" stroke={color} strokeWidth={2} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
