"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

interface WishlistButtonProps {
  productId: string;
  initialSaved: boolean;
  isAuthenticated: boolean;
}

const CONTROL_CLASSES = "flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-gold-champagne/50 px-4 py-2.5 text-sm font-semibold text-gold-dark transition-colors hover:border-gold-champagne hover:bg-gold-champagne/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-dark";

export function WishlistButton({ productId, initialSaved, isAuthenticated }: WishlistButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isAuthenticated) {
    return <Link href="/login" className={CONTROL_CLASSES}>سجّل الدخول لحفظ المنتجات في المفضلة</Link>;
  }

  function toggleWishlist() {
    if (isPending) return;
    const previousSaved = saved;
    const nextSaved = !previousSaved;
    setSaved(nextSaved);
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(
          previousSaved ? `/api/wishlist/${encodeURIComponent(productId)}` : "/api/wishlist",
          previousSaved
            ? { method: "DELETE" }
            : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) },
        );
        if (!response.ok) throw new Error("Wishlist mutation failed");
      } catch {
        setSaved(previousSaved);
        setError("تعذر الحفظ، حاول مرة أخرى");
      }
    });
  }

  const label = saved ? "إزالة من المفضلة" : "أضف إلى المفضلة";
  return (
    <div>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        disabled={isPending}
        onClick={toggleWishlist}
        className={`${CONTROL_CLASSES} disabled:cursor-wait disabled:opacity-65`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </svg>
        <span>{isPending ? "جارٍ الحفظ..." : label}</span>
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
