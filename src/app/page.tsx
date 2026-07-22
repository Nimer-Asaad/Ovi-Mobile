import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { getShopCtaHref, getPostLoginRedirect } from "@/lib/auth/redirects";
import { getCartEligibility } from "@/lib/cart";
import {
  getPriceModeForUser,
  getActiveCategories,
  getActiveBrands,
  PUBLIC_PRODUCT_CARD_SELECT,
  MERCHANT_PRODUCT_CARD_SELECT,
} from "@/lib/catalog-queries";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/catalog/ProductCard";
import { HeroBanner } from "@/components/storefront/HeroBanner";
import { CategoryStrip } from "@/components/storefront/CategoryStrip";
import { BrandShowcase } from "@/components/storefront/BrandShowcase";
import { TrustStrip } from "@/components/storefront/TrustStrip";
import { StorefrontSection } from "@/components/storefront/StorefrontSection";

// Queries live DB/session data on every request — force dynamic rendering
// explicitly so a future refactor can't accidentally make this eligible
// for build-time static generation (see DEPLOYMENT.md's Phase 29/31 notes
// on why build-time Prisma query bursts are risky).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSession();
  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);
  const shopCtaHref = getShopCtaHref(user);

  const [categories, brands, featuredProducts] = await Promise.all([
    getActiveCategories(),
    getActiveBrands(),
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
        <HeroBanner
          primaryHref={shopCtaHref}
          primaryLabel="تصفح المنتجات"
          secondaryHref={user ? getPostLoginRedirect(user) : "/login"}
          secondaryLabel={user ? "حسابي" : "تسجيل الدخول"}
          tertiaryHref={!user ? "/register/merchant" : undefined}
          tertiaryLabel={!user ? "انضم كتاجر جملة" : undefined}
        />

        <StorefrontSection title="تسوّق حسب القسم" subtitle="وصول أسرع إلى كل ما يحتاجه هاتفك">
          <CategoryStrip categories={categories} variant="cards" />
        </StorefrontSection>

        {featuredProducts.length > 0 && (
          <StorefrontSection
            title="منتجات مميزة"
            subtitle="منتجات مختارة بعناية تجمع بين الجودة والأداء"
            action={
              <Link href="/products" className="text-sm font-medium text-gold-dark hover:underline">
                عرض جميع المنتجات
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          </StorefrontSection>
        )}

        <StorefrontSection
          title="علامات نثق بها"
          subtitle="اكتشف منتجاتك المفضلة من علامات تجارية موثوقة"
          className="overflow-hidden border-y border-navy-soft bg-navy-surface"
        >
          <BrandShowcase brands={brands} />
        </StorefrontSection>

        <StorefrontSection>
          <TrustStrip />
        </StorefrontSection>
      </main>

      <Footer />
    </div>
  );
}
