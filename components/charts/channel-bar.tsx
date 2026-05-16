"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatARS } from "@/lib/format";

const COLORS = ["#F97316", "#FB923C", "#8B5CF6", "#A78BFA"];

export function ChannelBar({
  data,
}: {
  data: { canal: string; total: number }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="canal"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(v) => formatARS(v, { compact: true })}
            width={60}
          />
          <Tooltip
            cursor={{ fill: "rgba(249,115,22,0.08)" }}
            contentStyle={{
              background: "hsl(222 22% 8%)",
              border: "1px solid hsl(220 14% 18%)",
              borderRadius: 10,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            formatter={(v: number) => formatARS(v)}
          />
          <Bar dataKey="total" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
