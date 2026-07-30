import Link from "next/link";
import { Button } from "@/components/ui/Button";

export interface RepHeroProps {
  repName: string;
}

/** Compact dashboard hero for /rep — same dark navy "chrome" + gold-blur
 * visual language as the homepage HeroBanner and RepCarHero (bg-chrome,
 * gold-champagne accents), so the rep dashboard reads as part of the same
 * site instead of a disconnected tool. Deliberately not a carousel: this is
 * a welcome/orientation panel, not rotating promotional slides. */
export function RepHero({ repName }: RepHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-card bg-chrome px-6 py-8 shadow-card md:px-10 md:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-gold-champagne/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 -start-16 h-56 w-56 rounded-full bg-gold-light/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 text-center md:flex-row md:items-center md:justify-between md:text-start">
        <div>
          <p className="text-sm font-semibold tracking-wide text-gold-champagne">Ovi Mobile</p>
          <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">أهلاً بك، {repName}</h1>
          <p className="mt-2 max-w-md text-sm text-white/60">
            تابع مبيعاتك ومخزون سيارتك وتجارك من مكان واحد.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 md:justify-end">
          <Link href="/rep/sales/new">
            <Button size="lg">بيع جديد</Button>
          </Link>
          <Link href="/products">
            <Button
              variant="outline"
              size="lg"
              className="border-white/35 text-white hover:border-white/60 hover:bg-white/10"
            >
              تصفح المنتجات
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
