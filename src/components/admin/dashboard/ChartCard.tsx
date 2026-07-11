import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

/** Shared chart wrapper — title/subtitle header, fade-in entrance, subtle
 * hover lift, and a clean empty state instead of rendering an empty chart
 * when there's no data yet. Plain server component; the chart itself is the
 * only part that needs to be a Client Component. */
export function ChartCard({ title, subtitle, isEmpty, emptyMessage, children }: ChartCardProps) {
  return (
    <Card className="animate-fade-in transition-transform duration-200 hover:-translate-y-0.5">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <p className="mt-1 text-xs text-neutral-bg/50">{subtitle}</p>}
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? <EmptyState title="لا توجد بيانات كافية بعد" message={emptyMessage} /> : children}
      </CardContent>
    </Card>
  );
}
