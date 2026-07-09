"use client";

import { useActionState } from "react";
import { placeOrder, type CheckoutState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

const initialState: CheckoutState = {};

interface CheckoutFormProps {
  defaultName?: string;
}

export function CheckoutForm({ defaultName }: CheckoutFormProps) {
  const [state, formAction, isPending] = useActionState(placeOrder, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        name="contactName"
        label="الاسم الكامل"
        defaultValue={defaultName}
        required
        error={state.fieldErrors?.contactName}
      />
      <Input
        name="contactPhone"
        type="tel"
        label="رقم الهاتف"
        required
        error={state.fieldErrors?.contactPhone}
      />
      <Input name="city" label="المدينة / المنطقة" required error={state.fieldErrors?.city} />
      <Input name="address" label="العنوان" required error={state.fieldErrors?.address} />
      <Textarea name="notes" label="ملاحظات (اختياري)" error={state.fieldErrors?.notes} />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-neutral-bg/80">طريقة الدفع</span>
        <div className="rounded-card border border-navy-soft bg-navy-deep px-3 py-2.5 text-sm text-neutral-bg">
          الدفع عند الاستلام
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ تنفيذ الطلب..." : "تأكيد الطلب"}
      </Button>
    </form>
  );
}
