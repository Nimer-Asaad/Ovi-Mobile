import Link from "next/link";

const QUICK_LINKS = [
  { label: "من نحن", href: null },
  { label: "اتصل بنا", href: null },
  { label: "تسجيل الدخول", href: "/login" },
  { label: "المنتجات", href: "/products" },
  { label: "السلة", href: "/cart" },
  { label: "الطلبات", href: "/orders" },
] as const;

const SERVICE_LINKS = ["سياسة الخصوصية", "الاستبدال والإرجاع", "طرق الدفع"] as const;

const SOCIAL_INITIALS = ["f", "in", "ig"] as const;

/** Public site footer — full dark navy "chrome" to match the Header.
 * Every link here either points to a real route or is deliberately
 * rendered as plain (non-clickable) text — never a link to a page that
 * doesn't exist yet. */
export function Footer() {
  return (
    <footer className="border-t border-chrome-border bg-chrome text-white/70">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <span className="text-lg font-semibold tracking-wide text-gold-champagne">Ovi Mobile</span>
          <p className="text-sm text-white/50">
            إكسسوارات موبايل مميزة — بيع بالتجزئة والجملة لكل فلسطين. شواحن، كابلات، سماعات، وكفرات أصلية.
          </p>
          <div className="mt-1 flex items-center gap-2">
            {SOCIAL_INITIALS.map((initial) => (
              <span
                key={initial}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-xs font-medium text-white/60"
              >
                {initial}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-white">روابط مفيدة</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {QUICK_LINKS.map((link) =>
              link.href ? (
                <li key={link.label}>
                  <Link href={link.href} className="transition-colors hover:text-gold-light">
                    {link.label}
                  </Link>
                </li>
              ) : (
                <li key={link.label} className="text-white/40">
                  {link.label}
                </li>
              ),
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-white">خدمة العملاء</h3>
          <ul className="flex flex-col gap-2 text-sm text-white/40">
            {SERVICE_LINKS.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-white">حمّل التطبيق</h3>
          <div className="flex flex-col gap-2">
            {["App Store", "Google Play"].map((store) => (
              <div
                key={store}
                className="flex items-center gap-2 rounded-card border border-white/15 px-3 py-2 text-xs text-white/40"
              >
                <span>{store} — قريباً</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-chrome-border">
        <div className="mx-auto max-w-6xl px-4 py-5 text-center text-xs text-white/40">
          &copy; {new Date().getFullYear()} Ovi Mobile. جميع الحقوق محفوظة.
        </div>
      </div>
    </footer>
  );
}
