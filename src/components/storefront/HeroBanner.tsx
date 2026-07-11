import Link from "next/link";
import { Button } from "@/components/ui/Button";

export interface HeroBannerProps {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  tertiaryHref?: string;
  tertiaryLabel?: string;
}

/** Homepage hero — dark navy + teal accent, built from CSS gradients/shapes
 * only (no uploaded image assets). CTA destinations are always passed in by
 * the caller (driven by `getShopCtaHref` / `getPostLoginRedirect`), never
 * hardcoded here. */
export function HeroBanner({
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  tertiaryHref,
  tertiaryLabel,
}: HeroBannerProps) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-8 md:pt-12">
      <div className="relative animate-fade-in overflow-hidden rounded-card bg-chrome px-6 py-16 text-center shadow-card md:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-gold-champagne/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -start-24 h-72 w-72 rounded-full bg-gold-light/10 blur-3xl"
        />

        <p className="relative mb-3 text-sm font-semibold tracking-wide text-gold-champagne">Ovi Mobile</p>
        <h1 className="relative mx-auto max-w-2xl text-3xl font-bold text-white md:text-5xl">
          إكسسوارات موبايل بجودة عالية، بالتجزئة والجملة
        </h1>
        <p className="relative mx-auto mt-4 max-w-xl text-white/60">
          شواحن، كابلات، سماعات، وكفرات أصلية — توصيل سريع وأسعار تنافسية لكل فلسطين.
        </p>

        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={primaryHref}>
            <Button variant="primary" size="lg">
              {primaryLabel}
            </Button>
          </Link>
          <Link href={secondaryHref}>
            <Button
              variant="outline"
              size="lg"
              className="border-white/30 text-white hover:bg-white/10 hover:border-white/50"
            >
              {secondaryLabel}
            </Button>
          </Link>
        </div>

        {tertiaryHref && tertiaryLabel && (
          <Link
            href={tertiaryHref}
            className="relative mt-5 inline-block text-sm text-white/50 transition-colors hover:text-gold-light"
          >
            {tertiaryLabel}
          </Link>
        )}
      </div>
    </section>
  );
}
