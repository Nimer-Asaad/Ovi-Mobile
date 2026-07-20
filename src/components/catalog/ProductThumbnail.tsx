"use client";

import { useState } from "react";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";

interface ProductThumbnailProps {
  url: string;
  alt: string;
  className?: string;
}

/** Isolated as its own tiny client component (instead of making the whole,
 * otherwise server-rendered ProductCard client-side) purely so the broken
 * image icon never shows — falls back to the standard placeholder on
 * load failure. */
export function ProductThumbnail({ url, alt, className }: ProductThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <ProductImagePlaceholder className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
    <img src={url} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
  );
}
