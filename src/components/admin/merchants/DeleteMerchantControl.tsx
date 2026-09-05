"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { DeleteMerchantState } from "@/app/admin/merchants/actions";

interface DeleteMerchantControlProps {
  merchantName: string;
  /** Precomputed server-side by the page (same dependency counts
   * deleteMerchant itself re-checks before acting) — lets the confirm
   * dialog tell the admin the true outcome BEFORE they click, not just
   * after. deleteMerchant is still the sole authority on what actually
   * happens; this is only for accurate wording. */
  willArchiveInstead: boolean;
  /** True when the merchant has a login (Merchant.userId set) — always
   * archived rather than deleted, regardless of history, so the confirm
   * text can name the real reason instead of the generic "has financial
   * history" one. */
  isLoginLinked: boolean;
  action: () => Promise<DeleteMerchantState>;
}

/** Mirrors ProductRemovalControl's exact pattern (the same archive-vs-delete
 * confirm-dialog treatment already used for products) for merchants —
 * deleteMerchant (src/app/admin/merchants/actions.ts) is the one place that
 * decides and enforces which of the two actually happens; this component
 * only asks for confirmation and reports whatever it returns. */
export function DeleteMerchantControl({ merchantName, willArchiveInstead, isLoginLinked, action }: DeleteMerchantControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const description = !willArchiveInstead
    ? "سيتم حذف هذا التاجر نهائياً — لا يملك حساب دخول ولا أي طلبات أو دفعات أو سجل مالي."
    : isLoginLinked
      ? "لا يمكن حذف هذا التاجر نهائياً لأنه مرتبط بحساب دخول — سيتم إيقافه بدلاً من ذلك مع الاحتفاظ بالحساب والسجل."
      : "لا يمكن حذف هذا التاجر نهائياً لأنه يحتوي على فواتير أو دفعات أو سجل مالي — سيتم إيقافه بدلاً من ذلك مع الاحتفاظ بكامل السجل.";

  return (
    <div className="flex flex-col items-start gap-1">
      <ConfirmDialog
        title={willArchiveInstead ? "إيقاف التاجر" : "حذف التاجر نهائيًا"}
        description={
          <div className="flex flex-col gap-2">
            <p>{description}</p>
            <p className="font-medium text-neutral-bg">{merchantName}</p>
          </div>
        }
        confirmLabel={willArchiveInstead ? "إيقاف التاجر" : "حذف نهائي"}
        variant="danger"
        onConfirm={() => {
          if (isPending) return;
          setMessage(null);
          startTransition(async () => {
            const result = await action();
            setMessage({ text: result.error ?? result.success ?? "", ok: !result.error });
            if (!result.error) router.refresh();
          });
        }}
        trigger={(open) => (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={open}
            className="border-rose-500 text-rose-500 hover:bg-rose-500/10"
          >
            {isPending ? "جارٍ التنفيذ..." : "حذف التاجر"}
          </Button>
        )}
      />
      {message && (
        <span role={message.ok ? "status" : "alert"} className={`max-w-xs text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
