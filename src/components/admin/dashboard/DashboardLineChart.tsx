"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartValue, formatChartAxisTick, type ChartValueFormat } from "@/components/admin/dashboard/chart-format";

export interface DashboardLineChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  color?: string;
  valueFormat?: ChartValueFormat;
}

/** Generic single-line trend chart — used for orders-per-day, reused
 * anywhere else a simple day-over-day count is needed. */
export function DashboardLineChart({ data, xKey, yKey, color = "#18B7D3", valueFormat = "number" }: DashboardLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#E2E8F0" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: "#0F172A99" }} axisLine={{ stroke: "#E2E8F0" }} tickLine={false} />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: "#0F172A99" }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(value: number) => formatChartAxisTick(value, valueFormat)}
        />
        <Tooltip
          formatter={(value: unknown) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return [formatChartValue(numeric, valueFormat), ""];
          }}
          labelStyle={{ direction: "rtl" }}
          contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0", fontSize: 12, direction: "rtl" }}
        />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3, fill: color }}
          activeDot={{ r: 5 }}
          animationDuration={600}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
