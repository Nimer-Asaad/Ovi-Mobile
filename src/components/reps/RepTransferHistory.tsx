import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";
import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";

export interface RepTransferHistoryItem {
  id: string;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: Date;
  product: { sku: string; name: string; nameAr: string | null };
}

export interface RepTransferHistoryProps {
  movements: RepTransferHistoryItem[];
  /** When provided, REP_ASSIGNMENT rows link to the printable transfer
   * invoice for that rep. Omit on rep-facing pages — invoices are
   * admin-only. */
  repIdForInvoiceLinks?: string;
  emptyMessage?: string;
}

/** Rep-car-scoped movement list. Distinguishes the three movement types a
 * car location can see: REP_ASSIGNMENT (stock loaded in), REP_RETURN (stock
 * sent back to the warehouse), and SALE_OUT (sold from the car to a
 * customer) — purely via label/color/sign, the underlying stored `type`
 * values are untouched. */
export function RepTransferHistory({
  movements,
  repIdForInvoiceLinks,
  emptyMessage = "لا توجد حركات مخزون بعد",
}: RepTransferHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل حركات السيارة</CardTitle>
      </CardHeader>
      <CardContent>
        {movements.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col divide-y divide-navy-soft">
            {movements.map((movement) => {
              const isIncoming = movement.type === STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT;
              return (
                <div
                  key={movement.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-bg">{movement.product.nameAr ?? movement.product.name}</p>
                    <p className="text-xs text-neutral-bg/50">
                      {movement.product.sku} — {new Date(movement.createdAt).toLocaleString("ar")}
                    </p>
                    {movement.note && <p className="mt-0.5 text-xs text-neutral-bg/60">{movement.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                      {getMovementTypeLabel(movement.type)}
                    </Badge>
                    <span className={isIncoming ? "text-sm text-emerald-700" : "text-sm text-neutral-bg/70"}>
                      {isIncoming ? "+" : "-"}
                      {movement.quantity}
                    </span>
                    {repIdForInvoiceLinks && isIncoming && (
                      <Link
                        href={`/admin/reps/${repIdForInvoiceLinks}/transfers/${movement.id}/invoice`}
                        className="text-xs text-gold-champagne hover:underline"
                      >
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
