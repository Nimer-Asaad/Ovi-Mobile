"use client";

import { useActionState, useRef } from "react";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { confirmMerchantMergeAction, type ConfirmMerchantMergeState } from "@/app/admin/merchants/[id]/merge/actions";

interface MerchantMergeConfirmFormProps {
  targetMerchantId: string;
  sourceMerchantId: string;
  sourceName: string;
  targetName: string;
}

const initialState: ConfirmMerchantMergeState = {};

/** Final, explicit confirmation gate before the one destructive merge
 * submit — same ConfirmDialog pattern as ProductRemovalControl/
 * DeleteMerchantControl elsewhere in this app, never a bare
 * window.confirm. The visible trigger button only opens the warning
 * dialog; the real `<form action={formAction}>` (still driving
 * useActionState's pending/error state) is submitted programmatically only
 * once the admin explicitly confirms inside the dialog. */
export function MerchantMergeConfirmForm({ targetMerchantId, sourceMerchantId, sourceName, targetName }: MerchantMergeConfirmFormProps) {
  const [state, formAction, isPending] = useActionState(confirmMerchantMergeAction.bind(null, targetMerchantId), initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="sourceMerchantId" value={sourceMerchantId} />
      <ConfirmDialog
        title="تأكيد دمج التاجر"
        description={
          <div className="flex flex-col gap-2">
            <p>سيتم نقل جميع مبيعات ودفعات وذمة التاجر المكرر إلى التاجر الأساسي. لا تنفذ العملية إلا إذا كنت متأكداً أن السجلين لنفس التاجر.</p>
            <p className="font-medium text-neutral-bg">
              {sourceName} ← سيُدمج مع ← {targetName}
            </p>
          </div>
        }
        confirmLabel="تأكيد الدمج"
        variant="danger"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={(open) => (
          <Button type="button" disabled={isPending} onClick={open} className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500">
            {isPending ? "جارٍ الدمج..." : "دمج تاجر مكرر"}
          </Button>
        )}
      />
      {state.error && (
        <span role="alert" className="text-sm text-rose-600">
          {state.error}
        </span>
      )}
    </form>
  );
}
