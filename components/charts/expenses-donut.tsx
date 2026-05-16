"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatARS } from "@/lib/format";

export function ExpensesDonut({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 md:flex-row">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={64}
              outerRadius={92}
              paddingAngle={2}
              stroke="hsl(222 27% 5%)"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "hsl(222 22% 8%)",
                border: "1px solid hsl(220 14% 18%)",
                borderRadius: 10,
                fontSize: 12,
                color: "#e2e8f0",
              }}
              formatter={(v: number) => formatARS(v)}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-widest text-ink-subtle">
            Total mes
          </span>
          <span className="text-lg font-semibold tracking-tight text-ink">
            {formatARS(total, { compact: true })}
          </span>
        </div>
      </div>
      <ul className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
        {data.map((d) => {
          const pct = (d.value / total) * 100;
          return (
            <li key={d.name} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: d.color }}
                />
                <span className="text-ink">{d.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink-muted tabular-nums">
                  {formatARS(d.value, { compact: true })}
                </span>
                <span className="w-9 text-right text-ink-subtle tabular-nums">
                  {pct.toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
