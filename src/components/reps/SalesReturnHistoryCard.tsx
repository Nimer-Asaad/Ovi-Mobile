import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatBusinessDateTime, formatCurrencyFromCents } from "@/lib/utils";
import { getReturnStatusLabel } from "@/lib/sales-return-math";
import type { OrderReturnSummary, SalesReturnHistoryEntry } from "@/lib/sales-returns";

/** "مردودات الفاتورة" — read-only history of every return recorded against
 * one invoice, plus the derived status / total returned / remaining
 * returnable quantity. Server-rendered, never part of the printed invoice
 * (print:hidden) — each return has its own printable receipt. */
export function SalesReturnHistoryCard({
  orderNumber,
  summary,
  history,
}: {
  orderNumber: string;
  summary: Pick<OrderReturnSummary, "status" | "returnedUnits" | "remainingUnits" | "totalCreditCents">;
  history: SalesReturnHistoryEntry[];
}) {
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>مردودات الفاتورة</CardTitle>
        <Badge variant={summary.status === "NONE" ? "neutral" : "gold"}>{getReturnStatusLabel(summary.status)}</Badge>
      </CardHeader>
      <CardContent>
        <dl className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-bg/50">إجمالي المرتجع</dt>
            <dd className="font-semibold text-neutral-bg">{formatCurrencyFromCents(summary.totalCreditCents)}</dd>
          </div>
          <div>
            <dt className="text-neutral-bg/50">الكمية المرتجعة</dt>
            <dd className="font-semibold text-neutral-bg">{summary.returnedUnits}</dd>
          </div>
          <div>
            <dt className="text-neutral-bg/50">الكمية المتبقية القابلة للإرجاع</dt>
            <dd className="font-semibold text-neutral-bg">{summary.remainingUnits}</dd>
          </div>
        </dl>

        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-bg/50">لا توجد مردودات على هذه الفاتورة</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft">
            {history.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-neutral-bg">{entry.reference}</span>
                  <span className="text-xs text-neutral-bg/50">{formatBusinessDateTime(entry.businessCreatedAt)}</span>
                </div>
                <ul className="text-sm text-neutral-bg/80">
                  {entry.items.map((item) => (
                    <li key={item.orderItemId}>
                      {item.label} × {item.quantity}
                      {item.bonusQuantity > 0 && <span className="text-neutral-bg/50"> — منها بونص: {item.bonusQuantity}</span>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-neutral-bg/60">
                    المندوب: {entry.repName} — قيمة المردود:{" "}
                    <span className="font-semibold text-gold-champagne">{formatCurrencyFromCents(entry.totalCreditCents)}</span>
                  </span>
                  <Link href={`/rep/sales/${orderNumber}/returns/${entry.sequence}`} className="text-xs text-gold-champagne hover:underline">
                    سند المردود / طباعة
                  </Link>
                </div>
                {entry.note && <p className="text-xs text-neutral-bg/50">ملاحظة: {entry.note}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
