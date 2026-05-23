"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS } from "@/lib/format";

export function IncomeVsExpense({
  data,
}: {
  data: { mes: string; ingresos: number; egresos: number; resultado: number }[];
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ingresosFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F97316" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="egresosFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(v) => formatARS(v, { compact: true })}
            width={60}
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
            formatter={(v: number, name) => [
              formatARS(v),
              name === "ingresos" ? "Ingresos" : name === "egresos" ? "Egresos" : "Resultado",
            ]}
          />
          <Area
            type="monotone"
            dataKey="egresos"
            stroke="#A78BFA"
            strokeWidth={1.5}
            fill="url(#egresosFill)"
          />
          <Area
            type="monotone"
            dataKey="ingresos"
            stroke="#F97316"
            strokeWidth={2}
            fill="url(#ingresosFill)"
          />
          <Line
            type="monotone"
            dataKey="resultado"
            stroke="#84CC16"
            strokeWidth={2}
            dot={{ r: 3, fill: "#84CC16" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
