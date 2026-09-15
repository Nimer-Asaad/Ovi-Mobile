"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { deleteOnlineSaleAction } from "@/app/admin/online/actions";

interface OnlineSaleDeleteButtonProps {
  saleId: string;
  /** Shown in the confirmation dialog so the admin can double-check they're
   * removing the right row, e.g. "الجملة — 15/09/2026". */
  description: string;
}

/** Delete-with-confirmation for one ledger row — same ConfirmDialog +
 * useTransition + router.refresh() pattern as ProductRemovalControl. This
 * ledger has no downstream business effects, so a plain hard delete (no
 * cancellation/reversal record) is the deliberately simple correction model
 * here — see deleteOnlineSaleAction's own doc comment. */
export function OnlineSaleDeleteButton({ saleId, description }: OnlineSaleDeleteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmDialog
        title="حذف القيد"
        description={
          <div className="flex flex-col gap-2">
            <p>سيتم حذف هذا القيد نهائيًا من سجل مبيعات أون لاين.</p>
            <p className="font-medium text-neutral-bg">{description}</p>
          </div>
        }
        confirmLabel="حذف"
        variant="danger"
        onConfirm={() => {
          if (isPending) return;
          setError(null);
          startTransition(async () => {
            const result = await deleteOnlineSaleAction(saleId);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.refresh();
          });
        }}
        trigger={(open) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={open}
            className="border-rose-400 text-rose-700 hover:border-rose-500 hover:bg-rose-50"
          >
            {isPending ? "جارٍ الحذف..." : "حذف"}
          </Button>
        )}
      />
      {error && (
        <span role="alert" className="max-w-40 text-end text-xs text-rose-700">
          {error}
        </span>
      )}
    </div>
  );
}
