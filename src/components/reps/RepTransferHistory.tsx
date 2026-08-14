import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";
import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";

export interface RepTransferHistoryRow {
  key: string;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: Date;
  /** The single product's name (+ variant/combo label) for an ungrouped
   * movement, or "N منتجات" for a grouped multi-product transfer batch —
   * resolved by the caller so this component stays a pure renderer. */
  productLabel: string;
  /** Link to this row's printable invoice (single-movement or combined
   * batch invoice) — null for movement types with no invoice (e.g.
   * SALE_OUT). */
  invoiceHref: string | null;
}

export interface RepTransferHistoryProps {
  rows: RepTransferHistoryRow[];
  emptyMessage?: string;
}

/** Rep-car-scoped movement/transfer-batch history list. Distinguishes the
 * three movement types a car location can see: REP_ASSIGNMENT (stock loaded
 * in), REP_RETURN (stock sent back to the warehouse), and SALE_OUT (sold
 * from the car to a customer) — purely via label/color/sign, the underlying
 * stored `type` values are untouched. Multi-product transfers created in one
 * admin submission already arrive here pre-grouped into a single row (see
 * RepStockTransferBatch). */
export function RepTransferHistory({ rows, emptyMessage = "لا توجد حركات مخزون بعد" }: RepTransferHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل حركات السيارة</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft">
            {rows.map((row) => {
              const isIncoming = row.type === STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT;
              return (
                <div
                  key={row.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-bg">{row.productLabel}</p>
                    <p className="text-xs text-neutral-bg/50">{new Date(row.createdAt).toLocaleString("ar")}</p>
                    {row.note && <p className="mt-0.5 text-xs text-neutral-bg/60">{row.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getMovementTypeBadgeVariant(row.type)}>
                      {getMovementTypeLabel(row.type)}
                    </Badge>
                    <span className={isIncoming ? "text-sm text-emerald-700" : "text-sm text-neutral-bg/70"}>
                      {isIncoming ? "+" : "-"}
                      {row.quantity}
                    </span>
                    {row.invoiceHref && (
                      <Link href={row.invoiceHref} className="text-xs text-gold-champagne hover:underline">
                        طباعة الفاتورة
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
