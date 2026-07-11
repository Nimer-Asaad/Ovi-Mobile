/** Public site footer skeleton. */
export function Footer() {
  return (
    <footer className="border-t border-navy-soft bg-navy-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-10 text-center text-sm text-neutral-bg/60">
        <span className="font-semibold text-gold-dark">Ovi Mobile</span>
        <p>إكسسوارات موبايل مميزة — بيع بالتجزئة والجملة</p>
        <p>&copy; {new Date().getFullYear()} Ovi Mobile. جميع الحقوق محفوظة.</p>
      </div>
    </footer>
  );
}
