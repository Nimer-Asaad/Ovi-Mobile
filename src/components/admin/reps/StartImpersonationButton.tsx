"use client";

import { useActionState, useRef } from "react";
import { startImpersonationAction, type ImpersonationState } from "@/app/admin/reps/actions";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/Button";

const initialState: ImpersonationState = {};

interface StartImpersonationButtonProps {
  repId: string;
  repName: string;
}

/** "الدخول كمندوب" — the one entry point into REP impersonation. A plain
 * confirm-then-submit control (ConfirmDialog only calls onConfirm; the
 * actual authorization/validation happens entirely server-side inside
 * startImpersonationAction, exactly like every other server action in this
 * app — this button is a UX convenience, never the real boundary). On
 * success the action itself redirects to /rep; on failure (target
 * deactivated/missing) the error renders inline here instead. */
export function StartImpersonationButton({ repId, repName }: StartImpersonationButtonProps) {
  const action = startImpersonationAction.bind(null, repId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="inline-flex flex-col items-start gap-1">
      <ConfirmDialog
        trigger={(open) => (
          <Button type="button" onClick={open} disabled={isPending}>
            الدخول كمندوب
          </Button>
        )}
        title="الدخول كمندوب"
        description={
          <div className="flex flex-col gap-2">
            <p>
              المندوب: <span className="font-semibold text-neutral-bg">{repName}</span>
            </p>
            <p>ستدخل الآن إلى واجهة المندوب وتنفّذ العمليات بصلاحياته.</p>
          </div>
        }
        confirmLabel="الدخول كمندوب"
        cancelLabel="إلغاء"
        onConfirm={() => formRef.current?.requestSubmit()}
      />
      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
