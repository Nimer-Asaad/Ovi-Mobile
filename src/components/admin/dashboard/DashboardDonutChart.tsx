"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface DashboardDonutChartProps {
  data: Array<{ label: string; value: number; color: string }>;
}

/** Generic status-breakdown donut with a plain-text legend underneath
 * (rather than Recharts' own legend) so Arabic labels + counts stay
 * readable and RTL-aligned. */
export function DashboardDonutChart({ data }: DashboardDonutChartProps) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <ResponsiveContainer width="100%" height={200} className="max-w-[200px]">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={80} paddingAngle={2} animationDuration={600}>
            {data.map((slice) => (
              <Cell key={slice.label} fill={slice.color} stroke="#FFFFFF" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0", fontSize: 12, direction: "rtl" }} />
        </PieChart>
      </ResponsiveContainer>

      <ul className="flex w-full flex-col gap-2">
        {data.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-neutral-bg/80">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
              {slice.label}
            </span>
            <span className="font-medium text-neutral-bg">
              {slice.value}
              <span className="ms-1 text-xs text-neutral-bg/50">
                ({total > 0 ? Math.round((slice.value / total) * 100) : 0}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
