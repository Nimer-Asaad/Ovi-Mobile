"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";
import { cn } from "@/lib/utils";

export interface CartSuccessDrawerProps {
  open: boolean;
  onClose: () => void;
  /** All display fields are optional — if the caller couldn't supply full
   * product data, the drawer still opens with a graceful minimal message
   * instead of crashing or staying silent. */
  productName?: string;
  productSku?: string;
  productImageUrl?: string | null;
  quantity: number;
  /** The exact price already shown to this viewer for their role (retail or
   * wholesale) — never fetched or recalculated here, only multiplied by
   * quantity for the subtotal. */
  unitPriceCents?: number;
}

/** Success feedback after add-to-cart — rendered via a portal into
 * `document.body` so it's never clipped by an ancestor card's hover
 * transform (e.g. ProductCard's `hover:-translate-y-0.5`, which creates a
 * new containing block for `position: fixed` descendants). */
export function CartSuccessDrawer({
  open,
  onClose,
  productName,
  productSku,
  productImageUrl,
  quantity,
  unitPriceCents,
}: CartSuccessDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !hasOpened) return null;

  const hasDetails = Boolean(productName) && unitPriceCents !== undefined;
  const subtotalCents = hasDetails ? unitPriceCents! * quantity : 0;

  return createPortal(
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[100] bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-success-drawer-title"
        className={cn(
          "fixed inset-y-0 right-0 z-[110] flex w-full max-w-sm transform flex-col bg-navy-surface shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between bg-chrome px-5 py-4">
          <h2 id="cart-success-drawer-title" className="text-base font-semibold text-white">
            تمت الإضافة إلى السلة
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-card p-1 text-white/70 transition-colors hover:bg-chrome-surface hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {hasDetails ? (
            <div className="flex gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-card bg-navy-soft">
                {productImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                  <img src={productImageUrl} alt={productName} className="h-full w-full object-cover" />
                ) : (
                  <ProductImagePlaceholder className="h-full w-full" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <p className="font-medium text-neutral-bg">{productName}</p>
                {productSku && <p className="text-xs text-neutral-bg/50">SKU: {productSku}</p>}
                <p className="mt-1 text-sm text-neutral-bg/70">
                  الكمية: <span className="font-medium text-neutral-bg">{quantity}</span>
                </p>
                <p className="text-sm text-neutral-bg/70">
                  السعر: <span className="font-medium text-neutral-bg">{formatCurrencyFromCents(unitPriceCents!)}</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-bg/70">تمت إضافة المنتج إلى سلة التسوق بنجاح.</p>
          )}

          {hasDetails && (
            <div className="mt-4 flex items-center justify-between border-t border-navy-soft pt-4">
              <span className="text-sm text-neutral-bg/60">الإجمالي</span>
              <span className="text-lg font-semibold text-gold-champagne">
                {formatCurrencyFromCents(subtotalCents)}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-navy-soft p-5">
          <Link href="/checkout" onClick={onClose}>
            <Button variant="primary" className="w-full">
              إتمام الطلب
            </Button>
          </Link>
          <Link href="/cart" onClick={onClose}>
            <Button variant="secondary" className="w-full">
              عرض السلة
            </Button>
          </Link>
          <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
            متابعة التسوق
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
