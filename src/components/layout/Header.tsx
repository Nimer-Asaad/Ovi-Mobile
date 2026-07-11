import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getCartEligibility, getCartItemCount } from "@/lib/cart";

/** Public site header. Fetches the session itself (cheap: one cookie read +
 * an indexed lookup) so it can show cart access only to eligible viewers. */
export async function Header() {
  const user = await getSession();
  const cartEligibility = getCartEligibility(user);
  const cartCount =
    cartEligibility === "eligible" && user ? await getCartItemCount(user.id) : 0;

  return (
    <header className="sticky top-0 z-10 border-b border-navy-soft bg-navy-surface/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-navy-surface/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-wide text-gold-dark">
            Ovi Mobile
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-neutral-bg/70 md:flex">
          <Link href="/products" className="transition-colors hover:text-gold-champagne">
            المنتجات
          </Link>
          <Link href="/products" className="transition-colors hover:text-gold-champagne">
            الأقسام
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {cartEligibility === "eligible" && (
            <Link
              href="/cart"
              className="relative flex items-center gap-1.5 rounded-card px-2.5 py-1.5 text-sm text-neutral-bg/70 transition-colors hover:bg-navy-soft/60 hover:text-gold-dark"
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

          {user ? (
            <Link
              href="/dashboard"
              className="rounded-card border border-gold-champagne/40 px-3 py-1.5 text-xs font-medium text-gold-dark transition-colors hover:bg-gold-champagne/10"
            >
              حسابي
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-card border border-gold-champagne/40 px-3 py-1.5 text-xs font-medium text-gold-dark transition-colors hover:bg-gold-champagne/10"
            >
              تسجيل الدخول
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
