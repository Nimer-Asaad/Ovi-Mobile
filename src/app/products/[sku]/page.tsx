import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { ProductBreadcrumbs } from "@/components/catalog/ProductBreadcrumbs";
import { ProductPurchasePanel } from "@/components/catalog/ProductPurchasePanel";
import { ProductInfoTabs } from "@/components/catalog/ProductInfoTabs";
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

// Queries live DB/session data on every request — force dynamic rendering
// explicitly so a future refactor can't accidentally make this eligible
// for build-time static generation (see DEPLOYMENT.md's Phase 29/31 notes
// on why build-time Prisma query bursts are risky).
export const dynamic = "force-dynamic";

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
  // Main is always enforced IMAGE on save, but this stays defensive since
  // the gallery's images list here is unfiltered (it also carries videos).
  const mainImageUrl = product.images.find((image) => image.mediaType === "IMAGE")?.url ?? null;
  const priceCents = readCatalogPriceCents(product);
  const isWholesale = isWholesalePriced(product);
  const title = product.nameAr ?? product.name;
  const categoryName = product.category?.nameAr ?? product.category?.name ?? null;
  const brandName = product.brand?.name ?? null;

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
        <section className="mx-auto max-w-6xl px-4 py-8">
          <ProductBreadcrumbs category={product.category} productTitle={title} />

          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <ProductGallery images={product.images} name={title} />

            <ProductPurchasePanel
              productId={product.id}
              title={title}
              sku={product.sku}
              categoryName={categoryName}
              brandName={brandName}
              priceCents={priceCents}
              isWholesale={isWholesale}
              isFeatured={product.isFeatured}
              totalStock={totalStock}
              cartEligibility={cartEligibility}
              imageUrl={mainImageUrl}
            />
          </div>

          <div className="mt-10">
            <ProductInfoTabs
              description={product.descriptionAr ?? product.description}
              sku={product.sku}
              categoryName={categoryName}
              brandName={brandName}
              inStock={totalStock > 0}
            />
          </div>

          {relatedProducts.length > 0 && (
            <div className="mt-16 animate-fade-in">
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
