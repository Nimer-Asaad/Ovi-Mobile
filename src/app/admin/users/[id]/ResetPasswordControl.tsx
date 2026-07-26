"use client";

import { useActionState, useRef } from "react";
import { resetUserPassword, type ResetPasswordState } from "../actions";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

const initialState: ResetPasswordState = {};

interface ResetPasswordControlProps {
  userId: string;
  userName: string;
}

export function ResetPasswordControl({ userId, userName }: ResetPasswordControlProps) {
  const action = resetUserPassword.bind(null, userId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  if (state.generatedPassword) {
    return (
      <div className="rounded-card border border-emerald-300/50 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">تم تعيين كلمة مرور جديدة — انسخها الآن، لن تظهر مرة أخرى:</p>
        <p className="mt-2 font-mono text-emerald-950">{state.generatedPassword}</p>
        <p className="mt-3 text-xs text-emerald-800">
          سلّم كلمة المرور هذه لـ{userName} بنفسك (لم تُرسَل بالبريد الإلكتروني تلقائياً). تم تسجيل خروج
          هذا المستخدم من كل الأجهزة، وسيحتاج لتسجيل الدخول من جديد بها.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <ConfirmDialog
        title="تأكيد إعادة تعيين كلمة المرور"
        description={`سيتم توليد كلمة مرور جديدة لـ${userName} وتسجيل خروجه من كل الأجهزة فوراً. هل تريد المتابعة؟`}
        confirmLabel="إعادة تعيين كلمة المرور"
        variant="danger"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={(open) => (
          <Button type="button" variant="outline" disabled={isPending} onClick={open}>
            {isPending && <Spinner />}
            {isPending ? "جارٍ التعيين..." : "إعادة تعيين كلمة المرور"}
          </Button>
        )}
      />
      {state.error && (
        <p className="text-xs text-rose-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
