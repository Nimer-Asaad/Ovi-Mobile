import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility, getCartItemCount } from "@/lib/cart";
import { getPostLoginRedirect } from "@/lib/auth/redirects";
import { getActiveCategories } from "@/lib/catalog-queries";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { CategoryStrip } from "@/components/storefront/CategoryStrip";
import { ROLES } from "@/lib/constants";

function SearchForm({ className }: { className?: string }) {
  return (
    <form action="/products" method="GET" className={className} role="search">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          name="q"
          placeholder="ابحث عن منتج أو SKU..."
          className="h-10 w-full rounded-card border border-chrome-border bg-chrome-surface ps-9 pe-3 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
        />
      </div>
    </form>
  );
}

/** Public site header. Fetches the session itself (cheap: one cookie read +
 * an indexed lookup) so it can show cart access only to eligible viewers.
 * Two levels: a dark navy "chrome" bar (see tailwind.config.ts chrome.*
 * tokens, kept separate from the light navy.* tokens used by page content)
 * and a light category-navigation row built only from real `Category` rows. */
export async function Header() {
  const [user, categories] = await Promise.all([getSession(), getActiveCategories()]);
  const cartEligibility = getCartEligibility(user);
  const cartCount =
    cartEligibility === "eligible" && user ? await getCartItemCount(user.id) : 0;
  const isCustomer = user?.role === ROLES.RETAIL_CUSTOMER;
  const accountHref = user ? getPostLoginRedirect(user) : "/login";

  return (
    <header className="sticky top-0 z-40 border-b border-chrome-border bg-chrome shadow-sm">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex h-16 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-90">
            <span className="text-lg font-semibold tracking-wide text-gold-champagne">Ovi Mobile</span>
          </Link>

          <SearchForm className="hidden max-w-xl flex-1 md:block" />

          <div className="flex shrink-0 items-center gap-2">
            {cartEligibility === "eligible" && (
              <Link
                href="/cart"
                className="relative flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-sm text-white/75 transition-colors hover:bg-chrome-surface hover:text-gold-light"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span className="hidden sm:inline">السلة</span>
                {cartCount > 0 && (
                  <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-champagne px-1 text-[10px] font-semibold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
            )}

            {isCustomer && (
              <Link
                href="/orders"
                className="hidden rounded-card px-2.5 py-1.5 text-sm text-white/75 transition-colors hover:bg-chrome-surface hover:text-gold-light sm:inline-block"
              >
                طلباتي
              </Link>
            )}

            {user ? (
              <Link
                href={accountHref}
                className="rounded-card border border-gold-champagne/40 px-3 py-1.5 text-xs font-medium text-gold-light transition-colors hover:bg-gold-champagne/15"
              >
                حسابي
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-card border border-gold-champagne/40 px-3 py-1.5 text-xs font-medium text-gold-light transition-colors hover:bg-gold-champagne/15"
                >
                  تسجيل الدخول
                </Link>
                <Link
                  href="/register"
                  className="hidden rounded-card px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-gold-light sm:inline-block"
                >
                  إنشاء حساب
                </Link>
              </>
            )}

            {isCustomer && (
              <LogoutButton className="border-gold-champagne/40 text-gold-light hover:bg-chrome-surface" />
            )}
          </div>
        </div>

        <SearchForm className="pb-3 md:hidden" />
      </div>

      <div className="border-t border-navy-soft bg-navy-surface">
        <div className="mx-auto max-w-6xl">
          <CategoryStrip categories={categories} variant="pills" />
        </div>
      </div>
    </header>
  );
}
