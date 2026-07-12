import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import type { CartEligibility } from "@/lib/cart";

export interface ProductPurchasePanelProps {
  productId: string;
  title: string;
  sku: string;
  categoryName: string | null;
  brandName: string | null;
  priceCents: number;
  isWholesale: boolean;
  isFeatured: boolean;
  totalStock: number;
  cartEligibility: CartEligibility;
  imageUrl?: string | null;
}

/** Purchase card — title/meta/price/stock/cart action. Purely presentational:
 * every prop is a plain value the page already computes from the existing
 * price-mode select and `readCatalogPriceCents`/`isWholesalePriced` helpers,
 * so no pricing or cart logic lives here. */
export function ProductPurchasePanel({
  productId,
  title,
  sku,
  categoryName,
  brandName,
  priceCents,
  isWholesale,
  isFeatured,
  totalStock,
  cartEligibility,
  imageUrl,
}: ProductPurchasePanelProps) {
  return (
    <Card className="flex animate-fade-in flex-col gap-4 transition-shadow hover:shadow-lg">
      {isFeatured && <Badge variant="gold">مميز</Badge>}

      <div>
        <h1 className="text-2xl font-bold text-neutral-bg">{title}</h1>
        <p className="mt-1 text-xs text-neutral-bg/40">SKU: {sku}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-bg/60">
        {brandName && <span>{brandName}</span>}
        {categoryName && <Badge variant="neutral">{categoryName}</Badge>}
      </div>

      <div className="flex items-center gap-3 border-t border-navy-soft pt-4">
        <p className="text-3xl font-semibold text-gold-champagne">{formatCurrencyFromCents(priceCents)}</p>
        {isWholesale && <Badge variant="gold">سعر الجملة</Badge>}
      </div>

      <Badge variant={totalStock > 0 ? "success" : "danger"} className="self-start">
        {totalStock > 0 ? "متوفر" : "غير متوفر حالياً"}
      </Badge>

      <div className="mt-2">
        {cartEligibility === "guest" && (
          <Link
            href="/login"
            className="inline-block rounded-card border border-gold-champagne/40 px-4 py-2 text-sm text-gold-dark transition-colors hover:bg-gold-champagne/10"
          >
            سجّل الدخول للشراء
          </Link>
        )}
        {cartEligibility === "eligible" && totalStock > 0 && (
          <AddToCartButton
            productId={productId}
            maxQuantity={totalStock}
            showQuantityInput
            productName={title}
            productSku={sku}
            productImageUrl={imageUrl}
            unitPriceCents={priceCents}
          />
        )}
      </div>
    </Card>
  );
}
