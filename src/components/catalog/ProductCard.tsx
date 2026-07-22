import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { ProductThumbnail } from "@/components/catalog/ProductThumbnail";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { isWholesalePriced, readCatalogPriceCents } from "@/lib/catalog-queries";
import { LOW_STOCK_THRESHOLD, NEW_PRODUCT_DAYS } from "@/lib/constants";
import type { PublicProductCard, MerchantProductCard } from "@/lib/catalog-queries";
import type { CartEligibility } from "@/lib/cart";

interface ProductCardProps {
  product: PublicProductCard | MerchantProductCard;
  /** Defaults to "ineligible" so forgotten role checks never expose cart UI. */
  cartEligibility?: CartEligibility;
}

interface ProductStatusBadge {
  label: string;
  variant: BadgeVariant;
  className: string;
}

const NEW_PRODUCT_WINDOW_MS = NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000;

/** One premium storefront card shared by homepage, catalog, and related products.
 * Pricing and stock are read only from the caller's role-aware Prisma select. */
export function ProductCard({ product, cartEligibility = "ineligible" }: ProductCardProps) {
  const primaryImage = product.images[0];
  const secondaryImage = product.images[1];
  const priceCents = readCatalogPriceCents(product);
  const isWholesale = isWholesalePriced(product);
  const totalStock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
  const isOutOfStock = totalStock === 0;
  const isLowStock = totalStock > 0 && totalStock < LOW_STOCK_THRESHOLD;
  const productAgeMs = Date.now() - product.createdAt.getTime();
  const isNew = productAgeMs >= 0 && productAgeMs <= NEW_PRODUCT_WINDOW_MS;

  const statusBadges: ProductStatusBadge[] = [];
  if (isOutOfStock) {
    statusBadges.push({ label: "غير متوفر", variant: "danger", className: "border-rose-200 bg-white/95 text-rose-700" });
  } else if (isLowStock) {
    statusBadges.push({ label: "كمية محدودة", variant: "warning", className: "border-amber-200 bg-white/95 text-amber-700" });
  }
  if (isNew) {
    statusBadges.push({ label: "جديد", variant: "gold", className: "border-gold-champagne/50 bg-white/95 text-gold-dark" });
  }
  if (product.isFeatured) {
    statusBadges.push({ label: "مميز", variant: "gold", className: "border-gold-champagne/50 bg-navy-deep/90 text-gold-light" });
  }

  const visibleBadges = statusBadges.slice(0, 2);
  const productTitle = product.nameAr ?? product.name;

  return (
    <Card className="group relative flex h-full flex-col overflow-hidden rounded-[1.35rem] border-navy-soft/80 bg-white/90 p-0 shadow-[0_10px_32px_-24px_rgba(6,20,37,0.48)] transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-gold-champagne/55 hover:shadow-[0_22px_48px_-27px_rgba(6,20,37,0.5)] focus-within:border-gold-champagne/70 focus-within:shadow-[0_22px_48px_-27px_rgba(6,20,37,0.5)]">
      <Link
        href={`/products/${encodeURIComponent(product.sku)}`}
        className="flex flex-1 flex-col rounded-[1.35rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-dark"
        aria-label={`عرض ${productTitle}`}
      >
        <div className="relative aspect-square w-full overflow-hidden bg-navy-soft">
          {primaryImage ? (
            <ProductThumbnail
              url={primaryImage.url}
              alt={primaryImage.altText ?? productTitle}
              secondaryUrl={secondaryImage?.url}
              secondaryAlt={secondaryImage?.altText ?? `${productTitle} - صورة إضافية`}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.035] group-focus-within:scale-[1.035]"
            />
          ) : (
            <ProductImagePlaceholder className="h-full w-full" />
          )}

          {visibleBadges.length > 0 && (
            <div className="absolute start-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5" aria-label="حالة المنتج">
              {visibleBadges.map((badge) => (
                <Badge key={badge.label} variant={badge.variant} className={`shadow-sm backdrop-blur-sm ${badge.className}`}>
                  {badge.label}
                </Badge>
              ))}
            </div>
          )}

        </div>

        <div className="flex flex-1 flex-col px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          {(product.brand || product.category) && (
            <p className="mb-1.5 line-clamp-1 text-[11px] font-semibold tracking-wide text-gold-dark/75">
              {[product.brand?.name, product.category?.nameAr ?? product.category?.name].filter(Boolean).join(" · ")}
            </p>
          )}
          <CardTitle className="line-clamp-2 min-h-12 text-base font-bold leading-6 sm:text-lg">{productTitle}</CardTitle>
          <p className="mt-2 line-clamp-2 min-h-10 flex-1 text-sm leading-5 text-neutral-bg/60">
            {product.descriptionAr ?? product.description ?? ""}
          </p>

          <div className="mt-4 border-t border-navy-soft/70 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-gold-dark sm:text-2xl">
                {formatCurrencyFromCents(priceCents)}
              </span>
              {isWholesale && <Badge variant="gold">سعر جملة</Badge>}
            </div>
            <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${isOutOfStock ? "text-rose-700" : isLowStock ? "text-amber-700" : "text-emerald-700"}`}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {isOutOfStock ? "غير متوفر حاليًا" : isLowStock ? "كمية محدودة" : "متوفر"}
            </p>
          </div>
        </div>
      </Link>

      {cartEligibility !== "ineligible" && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {isOutOfStock ? (
            <button type="button" disabled className="min-h-10 w-full cursor-not-allowed rounded-card border border-navy-soft bg-navy-soft/65 px-3 py-2 text-sm font-semibold text-neutral-bg/45">
              غير متوفر حاليًا
            </button>
          ) : cartEligibility === "guest" ? (
            <Link href="/login" className="block min-h-10 rounded-card border border-gold-champagne/45 px-3 py-2 text-center text-sm font-semibold text-gold-dark transition-colors hover:border-gold-champagne hover:bg-gold-champagne/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">
              سجّل الدخول للشراء
            </Link>
          ) : (
            <AddToCartButton
              productId={product.id}
              productName={productTitle}
              productSku={product.sku}
              productImageUrl={primaryImage?.url ?? null}
              unitPriceCents={priceCents}
            />
          )}
        </div>
      )}
    </Card>
  );
}
