"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatChartValue, formatChartAxisTick, type ChartValueFormat } from "@/components/admin/dashboard/chart-format";

export interface DashboardBarChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  color?: string;
  /** Horizontal bars (category axis on the side) — reads better for longer
   * Arabic labels like product/rep names than vertical bars would. */
  horizontal?: boolean;
  valueFormat?: ChartValueFormat;
  height?: number;
}

/** Generic single-series bar chart — reused for sales-per-day, top stock
 * products, and rep sales by rep. */
export function DashboardBarChart({
  data,
  xKey,
  yKey,
  color = "#18B7D3",
  horizontal = false,
  valueFormat = "number",
  height = 240,
}: DashboardBarChartProps) {
  const tooltipFormatter = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return [formatChartValue(numeric, valueFormat), ""];
  };

  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#E2E8F0" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "#0F172A99" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => formatChartAxisTick(value, valueFormat)}
          />
          <YAxis
            type="category"
            dataKey={xKey}
            tick={{ fontSize: 12, fill: "#0F172A" }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip formatter={tooltipFormatter} contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0", fontSize: 12, direction: "rtl" }} />
          <Bar dataKey={yKey} fill={color} radius={[0, 6, 6, 0]} animationDuration={600} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
        <Tooltip formatter={tooltipFormatter} contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0", fontSize: 12, direction: "rtl" }} />
        <Bar dataKey={yKey} fill={color} radius={[6, 6, 0, 0]} animationDuration={600} />
      </BarChart>
    </ResponsiveContainer>
  );
}
