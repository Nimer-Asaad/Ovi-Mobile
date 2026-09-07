"use client";

import { useActionState } from "react";
import { endImpersonationAction, type ImpersonationState } from "@/app/admin/reps/actions";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

const initialState: ImpersonationState = {};

/** Rendered by /rep/layout.tsx on EVERY /rep page, only while
 * requireEffectiveRepresentative resolved an active ADMIN impersonation —
 * never for a real SALES_REPRESENTATIVE session. Deliberately impossible
 * to miss: impersonation is never invisible. The only control here is
 * "إنهاء وضع المندوب" — ending impersonation, never any extra ADMIN power
 * inside the REP interface. */
export function ImpersonationBanner({ repName }: { repName: string }) {
  const [state, formAction, isPending] = useActionState(endImpersonationAction, initialState);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-200 print:hidden">
      <span className="font-medium">أنت الآن تعمل كمندوب: {repName}</span>
      <form action={formAction} className="flex items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending && <Spinner />}
          إنهاء وضع المندوب
        </Button>
        {state.error && (
          <span className="text-xs text-rose-400" role="alert">
            {state.error}
          </span>
        )}
      </form>
    </div>
  );
}
