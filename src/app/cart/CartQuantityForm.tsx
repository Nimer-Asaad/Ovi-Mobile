"use client";

import { useActionState } from "react";
import { updateCartItemQuantity, type CartActionState } from "./actions";
import { Button } from "@/components/ui/Button";

const initialState: CartActionState = {};

interface CartQuantityFormProps {
  cartItemId: string;
  quantity: number;
  maxQuantity: number;
}

export function CartQuantityForm({ cartItemId, quantity, maxQuantity }: CartQuantityFormProps) {
  const action = updateCartItemQuantity.bind(null, cartItemId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          name="quantity"
          defaultValue={quantity}
          min={1}
          max={maxQuantity}
          className="h-9 w-20 rounded-card border border-navy-soft bg-navy-deep px-2 text-sm text-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          تحديث
        </Button>
      </div>
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
