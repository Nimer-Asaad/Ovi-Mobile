import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";
import type { PublicProductCard } from "@/lib/catalog-queries";

interface ProductCardProps {
  product: PublicProductCard;
}

/** Public-facing card — `product` only ever carries the fields selected by
 * `PUBLIC_PRODUCT_CARD_SELECT`, which never includes wholesale/cost price. */
export function ProductCard({ product }: ProductCardProps) {
  const thumbnail = product.images[0];

  return (
    <Link href={`/products/${encodeURIComponent(product.sku)}`}>
      <Card className="flex h-full flex-col overflow-hidden p-0 transition-colors hover:border-gold-champagne/50">
        <div className="aspect-square w-full bg-navy-soft">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
            <img
              src={thumbnail.url}
              alt={thumbnail.altText ?? product.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <ProductImagePlaceholder className="h-full w-full" />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-6">
          {product.isFeatured && <Badge variant="gold">مميز</Badge>}
          <CardTitle>{product.nameAr ?? product.name}</CardTitle>
          {product.brand && <p className="text-xs text-neutral-bg/50">{product.brand.name}</p>}
          <p className="line-clamp-2 flex-1 text-sm text-neutral-bg/70">
            {product.descriptionAr ?? product.description ?? ""}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-gold-champagne">
              {formatCurrencyFromCents(product.retailPriceCents)}
            </span>
            {product.category && (
              <Badge variant="neutral">{product.category.nameAr ?? product.category.name}</Badge>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
