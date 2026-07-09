import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility } from "@/lib/cart";
import { getPriceModeForUser, PUBLIC_PRODUCT_CARD_SELECT, MERCHANT_PRODUCT_CARD_SELECT } from "@/lib/catalog-queries";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ProductCard } from "@/components/catalog/ProductCard";

export default async function HomePage() {
  const user = await getSession();
  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);

  const [categories, featuredProducts] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      take: 4,
    }),
    priceMode === "wholesale"
      ? prisma.product.findMany({
          where: { isActive: true, isFeatured: true },
          select: MERCHANT_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : prisma.product.findMany({
          where: { isActive: true, isFeatured: true },
          select: PUBLIC_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-20 text-center">
          <p className="mb-3 text-sm font-medium tracking-wide text-gold-champagne">
            Ovi Mobile
          </p>
          <h1 className="mx-auto max-w-2xl text-3xl font-bold text-neutral-bg md:text-5xl">
            إكسسوارات موبايل بجودة عالية، بالتجزئة والجملة
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-neutral-bg/70">
            منصة عوفي موبايل لإدارة المبيعات والمخزون والتجار والمندوبين — قريباً.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/products">
              <Button variant="primary" size="lg">
                تصفح المنتجات
              </Button>
            </Link>
            <Button variant="outline" size="lg">
              انضم كتاجر جملة
            </Button>
          </div>
        </section>

        {featuredProducts.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-20">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-neutral-bg">منتجات مميزة</h2>
              <Link href="/products" className="text-sm text-gold-champagne hover:underline">
                عرض كل المنتجات
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          </section>
        )}

        {categories.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-20">
            <h2 className="mb-6 text-xl font-semibold text-neutral-bg">الأقسام المميزة</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((category) => (
                <Link key={category.id} href={`/products?category=${category.slug}`}>
                  <Card className="h-full transition-colors hover:border-gold-champagne/50">
                    <CardHeader>
                      <CardTitle>{category.nameAr ?? category.name}</CardTitle>
                    </CardHeader>
                    <CardContent>تصفح منتجات هذا القسم</CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
