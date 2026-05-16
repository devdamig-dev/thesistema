"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatARS } from "@/lib/format";

export function LaborVsSales({
  data,
}: {
  data: { dia: string; ventas: number; laboral: number }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap={14}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="dia" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickFormatter={(v) => formatARS(v, { compact: true })}
            width={60}
          />
          <Tooltip
            cursor={{ fill: "rgba(249,115,22,0.06)" }}
            contentStyle={{
              background: "hsl(222 22% 8%)",
              border: "1px solid hsl(220 14% 18%)",
              borderRadius: 10,
              fontSize: 12,
              color: "#e2e8f0",
            }}
            formatter={(v: number, name) => [
              formatARS(v),
              name === "ventas" ? "Ventas" : "Costo laboral",
            ]}
          />
          <Bar dataKey="ventas" fill="#F97316" radius={[6, 6, 0, 0]} />
          <Bar dataKey="laboral" fill="#A78BFA" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
