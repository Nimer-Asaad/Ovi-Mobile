"use client";

import { useActionState, useRef } from "react";
import { toggleUserActive, type UserActionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

const initialState: UserActionState = {};

interface AccountStatusToggleProps {
  userId: string;
  isActive: boolean;
}

export function AccountStatusToggle({ userId, isActive }: AccountStatusToggleProps) {
  const action = toggleUserActive.bind(null, userId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <ConfirmDialog
        title={isActive ? "تأكيد إيقاف الحساب" : "تأكيد تفعيل الحساب"}
        description={
          isActive
            ? "لن يتمكن هذا المستخدم من تسجيل الدخول بعد الإيقاف. هل تريد المتابعة؟"
            : "سيتمكن هذا المستخدم من تسجيل الدخول مجدداً. هل تريد المتابعة؟"
        }
        confirmLabel={isActive ? "إيقاف الحساب" : "تفعيل الحساب"}
        variant={isActive ? "danger" : "default"}
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={(open) => (
          <Button type="button" variant={isActive ? "outline" : "primary"} disabled={isPending} onClick={open}>
            {isPending && <Spinner />}
            {isPending ? "جارٍ التحديث..." : isActive ? "إيقاف الحساب" : "تفعيل الحساب"}
          </Button>
        )}
      />
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-xs text-emerald-600">{state.success}</p>}
    </form>
  );
}
