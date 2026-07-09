"use client";

import { useActionState } from "react";
import { addToCart, type CartActionState } from "@/app/cart/actions";
import { Button } from "@/components/ui/Button";

const initialState: CartActionState = {};

interface AddToCartButtonProps {
  productId: string;
  maxQuantity?: number;
  showQuantityInput?: boolean;
}

export function AddToCartButton({ productId, maxQuantity, showQuantityInput = false }: AddToCartButtonProps) {
  const action = addToCart.bind(null, productId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
      {showQuantityInput ? (
        <input
          type="number"
          name="quantity"
          defaultValue={1}
          min={1}
          max={maxQuantity}
          className="h-10 w-24 rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
        />
      ) : (
        <input type="hidden" name="quantity" value={1} />
      )}

      <Button
        type="submit"
        disabled={isPending}
        size="sm"
        className={showQuantityInput ? "w-full sm:w-auto" : "w-full"}
      >
        {isPending ? "جارٍ الإضافة..." : "إضافة للسلة"}
      </Button>

      {state.error && (
        <p className="text-xs text-rose-400" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-400">تمت الإضافة إلى السلة</p>}
    </form>
  );
}
