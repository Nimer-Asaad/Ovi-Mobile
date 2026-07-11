/** Shared value formatting for dashboard charts. Kept as a plain string
 * union ("number" | "currency") rather than a function prop, since
 * functions can't cross the Server → Client Component boundary — only
 * plain serializable data can. */
export type ChartValueFormat = "number" | "currency";

export function formatChartValue(value: number, format: ChartValueFormat = "number"): string {
  if (format === "currency") {
    return new Intl.NumberFormat("ar", { style: "currency", currency: "ILS", currencyDisplay: "symbol" }).format(
      value / 100,
    );
  }
  return new Intl.NumberFormat("ar").format(value);
}

/** Shorter axis-tick variant — compact notation so currency ticks (whole
 * shekels, not agorot) don't crowd the chart. */
export function formatChartAxisTick(value: number, format: ChartValueFormat = "number"): string {
  if (format === "currency") {
    return new Intl.NumberFormat("ar", { style: "currency", currency: "ILS", notation: "compact" }).format(
      value / 100,
    );
  }
  return new Intl.NumberFormat("ar", { notation: "compact" }).format(value);
}
