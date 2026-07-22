"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export interface HeroSlide {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
}

export interface HeroBannerProps {
  slides?: HeroSlide[];
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  tertiaryHref?: string;
  tertiaryLabel?: string;
}

/** Replace this array with admin-provided slide data when banner management is added. */
export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    id: "everyday-tech",
    eyebrow: "تقنية ترافق يومك",
    title: "كل ما يحتاجه هاتفك، بجودة تستحقها",
    description: "تشكيلة مختارة من الشواحن والكابلات والسماعات والإكسسوارات الأصلية.",
    imageSrc: "/home/hero-everyday-tech.svg",
    imageAlt: "إكسسوارات هاتف عصرية بتصميم أنيق",
  },
  {
    id: "fast-charging",
    eyebrow: "طاقة أسرع",
    title: "شحن موثوق يبقيك على اتصال",
    description: "حلول شحن حديثة للاستخدام اليومي، مختارة بعناية للأداء والأمان.",
    imageSrc: "/home/hero-fast-charging.svg",
    imageAlt: "شاحن وكابل بتقنية شحن سريع",
  },
  {
    id: "wholesale",
    eyebrow: "للأفراد والتجار",
    title: "خيارات أوسع، وخدمة أقرب إليك",
    description: "تسوّق بالتجزئة أو انضم كتاجر جملة واستفد من تجربة شراء تناسب أعمالك.",
    imageSrc: "/home/hero-wholesale.svg",
    imageAlt: "مجموعة منتجات موبايل جاهزة للمتاجر والعملاء",
  },
];

const AUTOPLAY_DELAY = 6500;

export function HeroBanner({
  slides = DEFAULT_HERO_SLIDES,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  tertiaryHref,
  tertiaryLabel,
}: HeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const goTo = useCallback(
    (index: number) => setActiveIndex((index + slides.length) % slides.length),
    [slides.length],
  );

  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const goPrevious = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

  useEffect(() => {
    if (isPaused || slides.length < 2) return;
    const interval = window.setInterval(goNext, AUTOPLAY_DELAY);
    return () => window.clearInterval(interval);
  }, [goNext, isPaused, slides.length]);

  if (slides.length === 0) return null;

  return (
    <section className="px-3 pt-4 sm:px-4 sm:pt-6 lg:px-6 lg:pt-8" aria-roledescription="carousel" aria-label="العروض الرئيسية">
      <div
        className="group relative mx-auto h-[34rem] max-w-[88rem] overflow-hidden rounded-[1.75rem] bg-chrome shadow-[0_28px_70px_-32px_rgba(6,20,37,0.72)] sm:h-[36rem] lg:h-[39rem]"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsPaused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") goNext();
          if (event.key === "ArrowRight") goPrevious();
        }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current === null) return;
          const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
          if (Math.abs(distance) > 45) {
            if (distance < 0) goNext();
            else goPrevious();
          }
          touchStartX.current = null;
        }}
      >
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            className={cn(
              "absolute inset-0 transition-[opacity,transform] duration-700 ease-out",
              index === activeIndex ? "z-10 scale-100 opacity-100" : "pointer-events-none scale-[1.025] opacity-0",
            )}
            aria-hidden={index !== activeIndex}
          >
            <Image
              src={slide.imageSrc}
              alt={slide.imageAlt}
              fill
              priority={index === 0}
              loading={index === 0 ? "eager" : "lazy"}
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#061525] via-[#061525]/78 to-[#061525]/15 lg:bg-gradient-to-l lg:from-[#061525]/95 lg:via-[#061525]/70 lg:to-transparent" />
            <div className="absolute inset-0 flex items-end lg:items-center">
              <div className="w-full px-6 pb-20 text-right sm:px-10 sm:pb-24 lg:max-w-3xl lg:px-16 lg:pb-0 xl:px-24">
                <p className="mb-4 text-sm font-bold tracking-wide text-gold-champagne sm:text-base">{slide.eyebrow}</p>
                <h1 className="max-w-2xl text-3xl font-bold leading-[1.3] text-white sm:text-4xl lg:text-5xl xl:text-6xl">
                  {slide.title}
                </h1>
                <p className="mt-5 max-w-xl text-sm leading-7 text-white/72 sm:text-base lg:text-lg">{slide.description}</p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link href={primaryHref} tabIndex={index === activeIndex ? 0 : -1}>
                    <Button variant="primary" size="lg">{primaryLabel}</Button>
                  </Link>
                  <Link href={secondaryHref} tabIndex={index === activeIndex ? 0 : -1}>
                    <Button variant="outline" size="lg" className="border-white/35 text-white hover:border-white/60 hover:bg-white/10">
                      {secondaryLabel}
                    </Button>
                  </Link>
                </div>
                {tertiaryHref && tertiaryLabel && (
                  <Link href={tertiaryHref} tabIndex={index === activeIndex ? 0 : -1} className="mt-5 inline-block text-sm text-white/60 transition-colors hover:text-gold-light">
                    {tertiaryLabel}
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}

        {slides.length > 1 && (
          <>
            <button type="button" onClick={goPrevious} aria-label="الشريحة السابقة" className="absolute end-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-navy-deep/55 text-2xl text-white backdrop-blur transition hover:border-gold-champagne/70 hover:bg-navy-deep/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light sm:flex">‹</button>
            <button type="button" onClick={goNext} aria-label="الشريحة التالية" className="absolute start-4 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-navy-deep/55 text-2xl text-white backdrop-blur transition hover:border-gold-champagne/70 hover:bg-navy-deep/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light sm:flex">›</button>
            <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-full bg-navy-deep/45 px-3 py-2 backdrop-blur" role="tablist" aria-label="اختيار الشريحة">
              {slides.map((slide, index) => (
                <button key={slide.id} type="button" onClick={() => goTo(index)} role="tab" aria-selected={index === activeIndex} aria-label={`عرض الشريحة ${index + 1}`} className={cn("h-2 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-light", index === activeIndex ? "w-7 bg-gold-champagne" : "w-2 bg-white/55 hover:bg-white")} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
