"use client";

import { useState } from "react";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { cn } from "@/lib/utils";

interface ProductGalleryProps {
  images: { url: string; altText: string | null }[];
  name: string;
}

export function ProductGallery({ images, name }: ProductGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return <ProductImagePlaceholder className="aspect-square w-full rounded-card" />;
  }

  const active = images[activeIndex] ?? images[0];

  return (
    <div className="flex animate-fade-in flex-col gap-3">
      <div className="group aspect-square w-full overflow-hidden rounded-card bg-navy-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs, next/image would require domain allowlisting */}
        <img
          src={active?.url}
          alt={active?.altText ?? name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      {images.length > 1 && (
        <div className="flex flex-wrap gap-2.5">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-current={index === activeIndex}
              className={cn(
                "h-16 w-16 shrink-0 overflow-hidden rounded-card border-2 transition-all hover:opacity-90",
                index === activeIndex
                  ? "border-gold-champagne shadow-sm"
                  : "border-navy-soft hover:border-gold-champagne/50",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see note above */}
              <img src={image.url} alt={image.altText ?? name} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
