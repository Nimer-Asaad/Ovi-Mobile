import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { isWholesalePriced, readCatalogPriceCents } from "@/lib/catalog-queries";
import type { PublicProductCard, MerchantProductCard } from "@/lib/catalog-queries";
import type { CartEligibility } from "@/lib/cart";

interface ProductCardProps {
  product: PublicProductCard | MerchantProductCard;
  /** Defaults to "ineligible" (no cart UI) so a page that forgets to pass
   * this never accidentally shows cart actions to the wrong viewer. */
  cartEligibility?: CartEligibility;
}

/** `product`'s shape is chosen by the caller's query (`PUBLIC_*_SELECT` vs
 * `MERCHANT_*_SELECT`) — this component only ever reads whichever price
 * field is actually present, never `costCents`. */
export function ProductCard({ product, cartEligibility = "ineligible" }: ProductCardProps) {
  const thumbnail = product.images[0];
  const priceCents = readCatalogPriceCents(product);
  const isWholesale = isWholesalePriced(product);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:border-gold-champagne/50 hover:shadow-lg">
      <Link href={`/products/${encodeURIComponent(product.sku)}`} className="flex flex-1 flex-col">
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

        <div className="flex flex-1 flex-col gap-2 p-6 pb-3">
          {product.isFeatured && <Badge variant="gold">مميز</Badge>}
          <CardTitle>{product.nameAr ?? product.name}</CardTitle>
          {product.brand && <p className="text-xs text-neutral-bg/50">{product.brand.name}</p>}
          <p className="line-clamp-2 flex-1 text-sm text-neutral-bg/70">
            {product.descriptionAr ?? product.description ?? ""}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-gold-champagne">
                {formatCurrencyFromCents(priceCents)}
              </span>
              {isWholesale && <Badge variant="gold">سعر الجملة</Badge>}
            </div>
            {product.category && (
              <Badge variant="neutral">{product.category.nameAr ?? product.category.name}</Badge>
            )}
          </div>
        </div>
      </Link>

      {cartEligibility !== "ineligible" && (
        <div className="px-6 pb-6">
          {cartEligibility === "guest" ? (
            <Link
              href="/login"
              className="block rounded-card border border-gold-champagne/40 px-3 py-2 text-center text-sm text-gold-dark transition-colors hover:bg-gold-champagne/10"
            >
              سجّل الدخول للشراء
            </Link>
          ) : (
            <AddToCartButton productId={product.id} />
          )}
        </div>
      )}
    </Card>
  );
}
