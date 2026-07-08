import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { ProductCard } from "@/components/catalog/ProductCard";
import { formatCurrencyFromCents } from "@/lib/utils";
import { PUBLIC_PRODUCT_CARD_SELECT, PUBLIC_PRODUCT_DETAIL_SELECT } from "@/lib/catalog-queries";

interface ProductDetailPageProps {
  params: Promise<{ sku: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { sku } = await params;

  const product = await prisma.product.findFirst({
    where: { sku: sku.toUpperCase(), isActive: true },
    select: PUBLIC_PRODUCT_DETAIL_SELECT,
  });

  if (!product) notFound();

  const totalStock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);

  const relatedProducts = product.categoryId
    ? await prisma.product.findMany({
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

              <p className="text-3xl font-semibold text-gold-champagne">
                {formatCurrencyFromCents(product.retailPriceCents)}
              </p>

              <Badge variant={totalStock > 0 ? "success" : "danger"} className="self-start">
                {totalStock > 0 ? "متوفر" : "غير متوفر حالياً"}
              </Badge>

              {(product.descriptionAr ?? product.description) && (
                <p className="leading-relaxed text-neutral-bg/80">
                  {product.descriptionAr ?? product.description}
                </p>
              )}

              <Button type="button" disabled className="mt-4 w-full sm:w-auto">
                إضافة للسلة قريباً
              </Button>
            </div>
          </div>

          {relatedProducts.length > 0 && (
            <div className="mt-16">
              <h2 className="mb-6 text-xl font-semibold text-neutral-bg">منتجات ذات صلة</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {relatedProducts.map((related) => (
                  <ProductCard key={related.id} product={related} />
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
