"use client";

import { useActionState, useEffect, useState } from "react";
import { addToCart, type CartActionState } from "@/app/cart/actions";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { CartSuccessDrawer } from "@/components/cart/CartSuccessDrawer";

const initialState: CartActionState = {};

interface AddToCartButtonProps {
  productId: string;
  maxQuantity?: number;
  showQuantityInput?: boolean;
  /** Optional display data for the post-add success drawer. All optional —
   * the drawer falls back to a minimal generic message when absent, so
   * call sites that can't supply these safely still work. */
  productName?: string;
  productSku?: string;
  productImageUrl?: string | null;
  /** The exact price already shown to this viewer for their role — never
   * refetched or recalculated, only passed through for display/subtotal. */
  unitPriceCents?: number;
}

export function AddToCartButton({
  productId,
  maxQuantity,
  showQuantityInput = false,
  productName,
  productSku,
  productImageUrl,
  unitPriceCents,
}: AddToCartButtonProps) {
  const action = addToCart.bind(null, productId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [quantity, setQuantity] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (state.success) setDrawerOpen(true);
  }, [state]);

  return (
    <>
      <form action={formAction} className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
        {showQuantityInput ? (
          <input
            type="number"
            name="quantity"
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            min={1}
            max={maxQuantity}
            className="h-10 w-24 rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
          />
        ) : (
          <input type="hidden" name="quantity" value={quantity} />
        )}

        <Button
          type="submit"
          disabled={isPending}
          size="sm"
          className={showQuantityInput ? "w-full sm:w-auto" : "w-full"}
        >
          {isPending && <Spinner />}
          {isPending ? "جارٍ الإضافة..." : "إضافة للسلة"}
        </Button>

        {state.error && (
          <p className="text-xs text-rose-600" role="alert">
            {state.error}
          </p>
        )}
      </form>

      <CartSuccessDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        productName={productName}
        productSku={productSku}
        productImageUrl={productImageUrl}
        quantity={quantity}
        unitPriceCents={unitPriceCents}
      />
    </>
  );
}
