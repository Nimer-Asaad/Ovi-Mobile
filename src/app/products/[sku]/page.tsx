import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/Badge";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility } from "@/lib/cart";
import {
  getPriceModeForUser,
  isWholesalePriced,
  readCatalogPriceCents,
  PUBLIC_PRODUCT_CARD_SELECT,
  PUBLIC_PRODUCT_DETAIL_SELECT,
  MERCHANT_PRODUCT_CARD_SELECT,
  MERCHANT_PRODUCT_DETAIL_SELECT,
} from "@/lib/catalog-queries";

interface ProductDetailPageProps {
  params: Promise<{ sku: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { sku } = await params;

  const user = await getSession();
  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);

  const product =
    priceMode === "wholesale"
      ? await prisma.product.findFirst({
          where: { sku: sku.toUpperCase(), isActive: true },
          select: MERCHANT_PRODUCT_DETAIL_SELECT,
        })
      : await prisma.product.findFirst({
          where: { sku: sku.toUpperCase(), isActive: true },
          select: PUBLIC_PRODUCT_DETAIL_SELECT,
        });

  if (!product) notFound();

  const totalStock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
  const priceCents = readCatalogPriceCents(product);
  const isWholesale = isWholesalePriced(product);

  const relatedProducts = product.categoryId
    ? priceMode === "wholesale"
      ? await prisma.product.findMany({
          where: { isActive: true, categoryId: product.categoryId, id: { not: product.id } },
          select: MERCHANT_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 4,
        })
      : await prisma.product.findMany({
          where: { isActive: true, categoryId: product.categoryId, id: { not: product.id } },
          select: PUBLIC_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 4,
        })
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-12">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <ProductGallery images={product.images} name={product.nameAr ?? product.name} />

            <div className="flex flex-col gap-4">
              {product.isFeatured && <Badge variant="gold">مميز</Badge>}
              <h1 className="text-2xl font-bold text-neutral-bg">{product.nameAr ?? product.name}</h1>

              <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-bg/60">
                {product.brand && <span>{product.brand.name}</span>}
                {product.category && (
                  <Badge variant="neutral">{product.category.nameAr ?? product.category.name}</Badge>
                )}
              </div>

              <div className="flex items-center gap-3">
                <p className="text-3xl font-semibold text-gold-champagne">
                  {formatCurrencyFromCents(priceCents)}
                </p>
                {isWholesale && <Badge variant="gold">سعر الجملة</Badge>}
              </div>

              <Badge variant={totalStock > 0 ? "success" : "danger"} className="self-start">
                {totalStock > 0 ? "متوفر" : "غير متوفر حالياً"}
              </Badge>

              {(product.descriptionAr ?? product.description) && (
                <p className="leading-relaxed text-neutral-bg/80">
                  {product.descriptionAr ?? product.description}
                </p>
              )}

              <div className="mt-4">
                {cartEligibility === "guest" && (
                  <Link
                    href="/login"
                    className="inline-block rounded-card border border-gold-champagne/40 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold-champagne/10"
                  >
                    سجّل الدخول للشراء
                  </Link>
                )}
                {cartEligibility === "eligible" && totalStock > 0 && (
                  <AddToCartButton productId={product.id} maxQuantity={totalStock} showQuantityInput />
                )}
              </div>
            </div>
          </div>

          {relatedProducts.length > 0 && (
            <div className="mt-16">
              <h2 className="mb-6 text-xl font-semibold text-neutral-bg">منتجات ذات صلة</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {relatedProducts.map((related) => (
                  <ProductCard key={related.id} product={related} cartEligibility={cartEligibility} />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
