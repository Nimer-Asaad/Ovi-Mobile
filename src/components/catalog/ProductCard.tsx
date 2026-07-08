import type { Brand, Category, Product } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyFromCents } from "@/lib/utils";

interface ProductCardProps {
  product: Product & { category: Category | null; brand: Brand | null };
}

/** Public-facing card — only ever reads `retailPriceCents`, never
 * `wholesalePriceCents` or `costCents`. */
export function ProductCard({ product }: ProductCardProps) {
  return (
    <Card className="flex h-full flex-col gap-3">
      <CardHeader className="flex-col items-start justify-center gap-1">
        {product.isFeatured && <Badge variant="gold">مميز</Badge>}
        <CardTitle>{product.nameAr ?? product.name}</CardTitle>
        {product.brand && <p className="text-xs text-neutral-bg/50">{product.brand.name}</p>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <p className="line-clamp-2 text-sm text-neutral-bg/70">
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
      </CardContent>
    </Card>
  );
}
