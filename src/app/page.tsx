import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { getShopCtaHref, getPostLoginRedirect } from "@/lib/auth/redirects";
import { getCartEligibility, getCartItemCount } from "@/lib/cart";
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
import { PromotionalBanner } from "@/components/storefront/PromotionalBanner";
import { CollectionsGrid } from "@/components/storefront/CollectionsGrid";
import { getHomepageCollections } from "@/lib/homepage-queries";
import { RecentlyViewedSection } from "@/components/storefront/RecentlyViewedSection";
import { ContinueShoppingCard } from "@/components/storefront/ContinueShoppingCard";

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

  const [categories, brands, featuredProducts, newArrivals, collections, cartItemCount] = await Promise.all([
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
    priceMode === "wholesale"
      ? prisma.product.findMany({
          where: { isActive: true },
          select: MERCHANT_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : prisma.product.findMany({
          where: { isActive: true },
          select: PUBLIC_PRODUCT_CARD_SELECT,
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
    getHomepageCollections(),
    user && cartEligibility === "eligible" ? getCartItemCount(user.id) : Promise.resolve(0),
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

        <ContinueShoppingCard cartItemCount={cartItemCount} />

        {featuredProducts.length > 0 && (
          <StorefrontSection
            title="منتجات مختارة"
            subtitle="اختيارات مميزة بعناية من أحدث إكسسوارات ومستلزمات الموبايل"
            action={
              <Link href="/products" className="rounded-full border border-gold-champagne/35 px-4 py-2 text-sm font-semibold text-gold-dark transition-colors hover:border-gold-champagne hover:bg-gold-champagne/10">
                عرض كل المنتجات
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          </StorefrontSection>
        )}

        {newArrivals.length > 0 && (
          <StorefrontSection
            title="وصل حديثًا"
            subtitle="أحدث المنتجات التي انضمت إلى متجر Ovi Mobile"
            className="border-y border-navy-soft/70 bg-white/35"
            action={
              <Link href="/products" className="rounded-full border border-gold-champagne/35 px-4 py-2 text-sm font-semibold text-gold-dark transition-colors hover:border-gold-champagne hover:bg-gold-champagne/10">
                عرض كل المنتجات
              </Link>
            }
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              {newArrivals.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          </StorefrontSection>
        )}

        {collections.length > 0 && (
          <StorefrontSection
            title="مجموعات مختارة"
            subtitle="وجهات سريعة إلى مجموعات متوفرة حاليًا في متجر Ovi Mobile"
          >
            <CollectionsGrid collections={collections} />
          </StorefrontSection>
        )}

        <RecentlyViewedSection cartEligibility={cartEligibility} />

        <StorefrontSection>
          <PromotionalBanner />
        </StorefrontSection>

        <StorefrontSection>
          <TrustStrip />
        </StorefrontSection>

        <StorefrontSection
          title="علامات نثق بها"
          subtitle="اكتشف منتجاتك المفضلة من علامات تجارية موثوقة"
          className="overflow-hidden border-y border-navy-soft bg-navy-surface"
        >
          <BrandShowcase brands={brands} />
        </StorefrontSection>
      </main>

      <Footer />
    </div>
  );
}
