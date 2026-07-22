import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ProductCard } from "@/components/catalog/ProductCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/lib/auth/guards";
import { getCartEligibility } from "@/lib/cart";
import { getPriceModeForUser } from "@/lib/catalog-queries";
import { getWishlistPage } from "@/lib/wishlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "المفضلة | Ovi Mobile",
  robots: { index: false, follow: false },
};

export default async function WishlistPage() {
  const user = await requireUser();
  const priceMode = getPriceModeForUser(user);
  const cartEligibility = getCartEligibility(user);
  const products = await getWishlistPage(user.id, priceMode);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-10">
          <PageHeader as="h1" title="المفضلة" subtitle="منتجاتك المحفوظة للعودة إليها بسهولة" />
          {products.length > 0 ? (
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} cartEligibility={cartEligibility} />
              ))}
            </div>
          ) : (
            <div className="mt-8">
              <EmptyState
                as="h2"
                title="لا توجد منتجات في المفضلة"
                message="احفظ المنتجات التي تعجبك لتعود إليها بسهولة لاحقًا"
                action={<Link href="/products" className="inline-flex min-h-11 items-center rounded-card bg-gold-champagne px-5 py-2.5 text-sm font-semibold text-navy-deep transition-colors hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark">تصفح المنتجات</Link>}
              />
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
