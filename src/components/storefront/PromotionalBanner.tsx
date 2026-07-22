import Image from "next/image";
import Link from "next/link";

export interface PromotionalBannerContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  imageSrc: string;
  imageAlt: string;
}

export const DEFAULT_PROMOTIONAL_BANNER: PromotionalBannerContent = {
  eyebrow: "اختيارات تناسب يومك",
  title: "تسوّق كل ما تحتاجه لموبايلك",
  subtitle: "تشكيلة متجددة من الكفرات، الشواحن، السماعات والإكسسوارات",
  ctaLabel: "تصفح المنتجات",
  ctaHref: "/products",
  imageSrc: "/home/accessories-promotion.svg",
  imageAlt: "تشكيلة من إكسسوارات الموبايل",
};

/** Static today, but content is fully injectable for future admin-managed banners. */
export function PromotionalBanner({ content = DEFAULT_PROMOTIONAL_BANNER }: { content?: PromotionalBannerContent }) {
  return (
    <aside className="relative min-h-[25rem] overflow-hidden rounded-[1.75rem] bg-chrome shadow-[0_24px_65px_-34px_rgba(6,20,37,0.75)] sm:min-h-[22rem]" aria-label="اكتشف منتجات Ovi Mobile">
      <Image src={content.imageSrc} alt={content.imageAlt} fill loading="lazy" sizes="(max-width: 1200px) 100vw, 1152px" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#061525] via-[#061525]/88 to-[#061525]/20 sm:bg-gradient-to-l sm:from-[#061525]/96 sm:via-[#061525]/78 sm:to-[#061525]/12" />
      <div className="relative z-10 flex min-h-[25rem] items-end px-6 py-10 sm:min-h-[22rem] sm:items-center sm:px-10 lg:px-16">
        <div className="max-w-xl">
          <p className="text-sm font-bold text-gold-champagne">{content.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl">{content.title}</h2>
          <p className="mt-4 text-sm leading-7 text-white/70 sm:text-base">{content.subtitle}</p>
          <Link href={content.ctaHref} className="mt-7 inline-flex min-h-11 items-center justify-center rounded-card bg-gold-champagne px-6 py-3 text-sm font-bold text-navy-deep shadow-lg transition hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light">
            {content.ctaLabel}
          </Link>
        </div>
      </div>
    </aside>
  );
}
