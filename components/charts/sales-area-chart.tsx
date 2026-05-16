"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS } from "@/lib/format";

export function SalesAreaChart({
  data,
}: {
  data: { day: string; ventas: number; costo: number }[];
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ventasFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F97316" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="costoFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="day"
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
            cursor={{ stroke: "rgba(249,115,22,0.4)", strokeWidth: 1 }}
            contentStyle={{
              background: "hsl(222 22% 8%)",
              border: "1px solid hsl(220 14% 18%)",
              borderRadius: 10,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            labelStyle={{ color: "#94a3b8", marginBottom: 4 }}
            formatter={(value: number, name) => [
              formatARS(value),
              name === "ventas" ? "Ventas" : "Costo",
            ]}
          />
          <Area
            type="monotone"
            dataKey="costo"
            stroke="#8B5CF6"
            strokeWidth={1.5}
            fill="url(#costoFill)"
          />
          <Area
            type="monotone"
            dataKey="ventas"
            stroke="#F97316"
            strokeWidth={2}
            fill="url(#ventasFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
