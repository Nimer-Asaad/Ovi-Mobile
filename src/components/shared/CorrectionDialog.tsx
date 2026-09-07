"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Spinner } from "@/components/ui/Spinner";

export interface CorrectionActionState {
  error?: string;
  success?: string;
}

interface CorrectionDialogProps {
  /** One of correctSaleAction / cancelManualPaymentAction / correctRepSaleAction
   * / cancelRepManualPaymentAction / cancelManualInventoryBatchAction — every
   * correction server action shares this exact (prevState, formData) =>
   * {error?, success?} shape, so this one dialog serves all of them. */
  action: (state: CorrectionActionState, formData: FormData) => Promise<CorrectionActionState>;
  /** Extra fields submitted alongside `reason` — e.g. { orderNumber } or
   * { paymentId } or { batchId } — whichever id the target action expects. */
  hiddenFields: Record<string, string>;
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  /** Small, table-row-friendly trigger styling by default; pass a wider
   * className for a standalone page button. */
  triggerClassName?: string;
  /** Shown as a link alongside the success message once the correction
   * succeeds — "إنشاء مبيعة صحيحة" / "تسجيل دفعة صحيحة" / "إدخال عملية
   * صحيحة". Never auto-navigates and never auto-creates anything — the
   * user explicitly clicks through and fills in the replacement
   * themselves. Omit to show only the plain success message. */
  replacementHref?: string;
  replacementLabel?: string;
}

const initialState: CorrectionActionState = {};

/** The one shared "سبب التصحيح / الإلغاء" dialog every correction control in
 * this feature uses — REP's own sale/payment correction, ADMIN/ADMIN_ASSISTANT's
 * company-wide sale/payment correction, and the inventory batch cancel
 * control. Requires a non-empty reason before the underlying server action
 * is ever called (the action itself re-validates this server-side too —
 * this is only the UI-side prompt, never the real enforcement). On success,
 * the dialog closes and shows a brief confirmation; the calling page's own
 * revalidatePath (inside the server action) refreshes the underlying row. */
export function CorrectionDialog({
  action,
  hiddenFields,
  triggerLabel,
  title,
  description,
  confirmLabel,
  triggerClassName,
  replacementHref,
  replacementLabel,
}: CorrectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      setOpen(false);
    }
  }, [state.success]);

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={triggerClassName ?? "text-rose-600 hover:bg-rose-50"} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>

      {state.success && !open && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-emerald-600">{state.success}</p>
          {replacementHref && replacementLabel && (
            <Link href={replacementHref} className="text-xs text-gold-champagne hover:underline">
              {replacementLabel}
            </Link>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="correction-dialog-title">
          <div className="w-full max-w-md rounded-card border border-navy-soft bg-navy-surface p-6 shadow-card">
            <h3 id="correction-dialog-title" className="text-base font-semibold text-neutral-bg">
              {title}
            </h3>
            <p className="mt-2 text-sm text-neutral-bg/70">{description}</p>

            <form action={formAction} className="mt-4 flex flex-col gap-3">
              {Object.entries(hiddenFields).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Textarea name="reason" label="سبب التصحيح / الإلغاء" required placeholder="مثال: تم إدخال المبلغ بالخطأ" />

              {state.error && (
                <p className="text-sm text-rose-500" role="alert">
                  {state.error}
                </p>
              )}

              <div className="mt-2 flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                  إلغاء
                </Button>
                <Button type="submit" className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500" disabled={isPending}>
                  {isPending && <Spinner />}
                  {confirmLabel}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
