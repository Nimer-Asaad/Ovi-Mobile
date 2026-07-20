"use client";

import { useState } from "react";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { cn } from "@/lib/utils";

interface ProductGalleryProps {
  images: { url: string; altText: string | null; mediaType: string }[];
  name: string;
}

export function ProductGallery({ images, name }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Tracks image URLs that failed to load so we can fall back to the design
  // system's placeholder instead of ever showing the browser's broken-image
  // icon — keyed by URL, not index, so it survives thumbnail re-ordering.
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  if (images.length === 0) {
    return <ProductImagePlaceholder className="aspect-square w-full rounded-card" />;
  }

  const active = images[activeIndex] ?? images[0];
  const activeFailed = !!active && failedUrls.has(active.url);

  function markFailed(url: string) {
    setFailedUrls((prev) => new Set(prev).add(url));
  }

  return (
    <div className="flex animate-fade-in flex-col gap-3">
      <div className="group flex aspect-square w-full items-center justify-center overflow-hidden rounded-card bg-navy-soft">
        {activeFailed || !active ? (
          <ProductImagePlaceholder className="h-full w-full" />
        ) : active.mediaType === "VIDEO" ? (
          <video
            src={active.url}
            className="h-full w-full object-contain"
            controls
            onError={() => markFailed(active.url)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered/uploaded URLs
          <img
            src={active.url}
            alt={active.altText ?? name}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
            onError={() => markFailed(active.url)}
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="flex flex-wrap gap-2.5">
          {images.map((image, index) => {
            const thumbFailed = failedUrls.has(image.url);
            return (
              <button
                key={image.url}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-current={index === activeIndex}
                className={cn(
                  "relative h-16 w-16 shrink-0 overflow-hidden rounded-card border-2 transition-all hover:opacity-90",
                  index === activeIndex
                    ? "border-gold-champagne shadow-sm"
                    : "border-navy-soft hover:border-gold-champagne/50",
                )}
              >
                {thumbFailed ? (
                  <ProductImagePlaceholder className="h-full w-full" />
                ) : image.mediaType === "VIDEO" ? (
                  <div className="relative h-full w-full">
                    <video
                      src={image.url}
                      className="h-full w-full object-cover"
                      muted
                      onError={() => markFailed(image.url)}
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-navy-deep/30 text-[10px] font-semibold text-neutral-bg">
                      ▶
                    </span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- see note above
                  <img
                    src={image.url}
                    alt={image.altText ?? name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={() => markFailed(image.url)}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
