"use client";

import { useActionState } from "react";
import { updateMerchantStatus, type MerchantStatusState } from "./actions";
import { Button } from "@/components/ui/Button";
import { MERCHANT_STATUSES } from "@/lib/constants";

const initialState: MerchantStatusState = {};

interface StatusButtonProps {
  merchantId: string;
  targetStatus: string;
  label: string;
  variant?: "outline";
}

function StatusButton({ merchantId, targetStatus, label, variant }: StatusButtonProps) {
  const action = updateMerchantStatus.bind(null, merchantId, targetStatus);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <Button type="submit" variant={variant} disabled={isPending}>
        {isPending ? "جارٍ التحديث..." : label}
      </Button>
      {state.error && (
        <p className="text-xs text-rose-400" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  );
}

interface MerchantStatusActionsProps {
  merchantId: string;
  currentStatus: string;
}

export function MerchantStatusActions({ merchantId, currentStatus }: MerchantStatusActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {currentStatus !== MERCHANT_STATUSES.APPROVED && (
        <StatusButton merchantId={merchantId} targetStatus={MERCHANT_STATUSES.APPROVED} label="اعتماد التاجر" />
      )}
      {currentStatus !== MERCHANT_STATUSES.REJECTED && (
        <StatusButton
          merchantId={merchantId}
          targetStatus={MERCHANT_STATUSES.REJECTED}
          label="رفض التاجر"
          variant="outline"
        />
      )}
      {currentStatus !== MERCHANT_STATUSES.PENDING && (
        <StatusButton
          merchantId={merchantId}
          targetStatus={MERCHANT_STATUSES.PENDING}
          label="إعادة إلى قيد المراجعة"
          variant="outline"
        />
      )}
    </div>
  );
}
