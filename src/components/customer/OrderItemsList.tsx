import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";

export interface OrderItemRow {
  id: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  product: {
    sku: string;
    name: string;
    nameAr: string | null;
    images: { url: string; altText: string | null }[];
  };
}

export interface OrderItemsListProps {
  items: OrderItemRow[];
  /** Wholesale orders show a "(سعر الجملة)" hint next to the unit price —
   * purely a label, the price itself is whatever the order already stored
   * at checkout time. */
  isWholesaleOrder?: boolean;
}

/** Product rows for an order — image (or placeholder), name, SKU, quantity
 * × unit price, and the line total. Every value comes from the order's own
 * `OrderItem`/`Product` selection; nothing is fetched or computed here. */
export function OrderItemsList({ items, isWholesaleOrder = false }: OrderItemsListProps) {
  return (
    <div className="flex flex-col divide-y divide-navy-soft">
      {items.map((item) => {
        const thumbnail = item.product.images[0];
        return (
          <div key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-card bg-navy-soft">
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                <img
                  src={thumbnail.url}
                  alt={thumbnail.altText ?? item.product.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <ProductImagePlaceholder className="h-full w-full" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-neutral-bg">{item.product.nameAr ?? item.product.name}</p>
              <p className="text-xs text-neutral-bg/50">{item.product.sku}</p>
              <p className="text-xs text-neutral-bg/60">
                {formatCurrencyFromCents(item.unitPriceCents)}
                {isWholesaleOrder && " (سعر الجملة)"} × {item.quantity}
              </p>
            </div>
            <span className="font-semibold text-neutral-bg">{formatCurrencyFromCents(item.totalCents)}</span>
          </div>
        );
      })}
    </div>
  );
}
