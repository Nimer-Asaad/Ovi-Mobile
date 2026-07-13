import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { isLowStock } from "@/lib/inventory";

export interface RepCarProductGridItem {
  productId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  quantity: number;
  categoryLabel: string | null;
  brandLabel: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface RepCarProductGridProps {
  items: RepCarProductGridItem[];
  title?: string;
  emptyMessage?: string;
}

/** Visual "what's currently loaded in the car" grid — replaces a plain
 * table with product cards + a quantity badge, so the rep/admin can scan
 * the car's contents at a glance. Only ever receives items with
 * quantity > 0 (callers filter before passing in). */
export function RepCarProductGrid({
  items,
  title = "المنتجات في السيارة",
  emptyMessage = "لا يوجد مخزون في السيارة حالياً",
}: RepCarProductGridProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-bg/50">{emptyMessage}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => {
              const lowStock = isLowStock(item.quantity);
              return (
                <div
                  key={item.productId}
                  className="flex flex-col overflow-hidden rounded-card border border-navy-soft bg-navy-deep"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-navy-soft">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                      <img
                        src={item.thumbnailUrl}
                        alt={item.thumbnailAlt ?? item.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <ProductImagePlaceholder className="h-full w-full" />
                    )}
                    <span className="absolute end-1.5 top-1.5 inline-flex min-w-6 items-center justify-center rounded-full bg-chrome px-1.5 py-0.5 text-xs font-semibold text-white shadow-card">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <p className="line-clamp-2 text-xs font-medium text-neutral-bg">
                      {item.nameAr ?? item.name}
                    </p>
                    <p className="text-[11px] text-neutral-bg/50">{item.sku}</p>
                    {lowStock && (
                      <Badge variant="warning" className="mt-auto self-start">
                        مخزون منخفض
                      </Badge>
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
