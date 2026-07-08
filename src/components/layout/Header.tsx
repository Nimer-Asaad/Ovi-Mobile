import Link from "next/link";

/** Public site header. Skeleton only — navigation links are placeholders
 * until the catalog (Phase 3) and auth (Phase 2) phases land. */
export function Header() {
  return (
    <header className="border-b border-navy-soft bg-navy-deep">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-wide text-gold-champagne">
            Ovi Mobile
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-neutral-bg/80 md:flex">
          <span className="cursor-default">المنتجات</span>
          <span className="cursor-default">الأقسام</span>
          <span className="cursor-default">تواصل معنا</span>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-card border border-gold-champagne/40 px-3 py-1.5 text-xs text-gold-light transition-colors hover:bg-gold-champagne/10"
          >
            تسجيل الدخول
          </Link>
        </div>
      </div>
    </header>
  );
}
