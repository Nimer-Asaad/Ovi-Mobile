"use client";

import { useState } from "react";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";

interface ProductThumbnailProps {
  url: string;
  alt: string;
  secondaryUrl?: string;
  secondaryAlt?: string;
  priority?: boolean;
  className?: string;
}

/** Isolated as its own tiny client component (instead of making the whole,
 * otherwise server-rendered ProductCard client-side) purely so the broken
 * image icon never shows — falls back to the standard placeholder on
 * load failure. */
export function ProductThumbnail({
  url,
  alt,
  secondaryUrl,
  secondaryAlt,
  priority = false,
  className,
}: ProductThumbnailProps) {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [secondaryFailed, setSecondaryFailed] = useState(false);

  if (primaryFailed) {
    return <ProductImagePlaceholder className={className} />;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs */}
      <img
        src={url}
        alt={alt}
        className={className}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onError={() => setPrimaryFailed(true)}
      />
      {secondaryUrl && !secondaryFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
        <img
          src={secondaryUrl}
          alt={secondaryAlt ?? alt}
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-[opacity,transform] duration-500 group-hover:scale-[1.02] group-hover:opacity-100 group-focus-within:scale-[1.02] group-focus-within:opacity-100"
          loading="lazy"
          decoding="async"
          onError={() => setSecondaryFailed(true)}
        />
      )}
    </>
  );
}
