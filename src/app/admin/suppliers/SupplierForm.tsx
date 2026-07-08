"use client";

import { useActionState } from "react";
import type { Supplier } from "@prisma/client";
import { createSupplier, updateSupplier, type SupplierFormState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

interface SupplierFormProps {
  supplier?: Supplier;
}

const initialState: SupplierFormState = {};

export function SupplierForm({ supplier }: SupplierFormProps) {
  const action = supplier ? updateSupplier.bind(null, supplier.id) : createSupplier;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <Input
        name="name"
        label="اسم المورد"
        defaultValue={supplier?.name}
        required
        error={state.fieldErrors?.name}
      />
      <Input
        name="contactName"
        label="اسم جهة الاتصال (اختياري)"
        defaultValue={supplier?.contactName ?? ""}
        error={state.fieldErrors?.contactName}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          name="phone"
          type="tel"
          label="الهاتف (اختياري)"
          defaultValue={supplier?.phone ?? ""}
          error={state.fieldErrors?.phone}
        />
        <Input
          name="email"
          type="email"
          label="البريد الإلكتروني (اختياري)"
          defaultValue={supplier?.email ?? ""}
          error={state.fieldErrors?.email}
        />
      </div>

      <Input
        name="address"
        label="العنوان (اختياري)"
        defaultValue={supplier?.address ?? ""}
        error={state.fieldErrors?.address}
      />
      <Textarea
        name="notes"
        label="ملاحظات (اختياري)"
        defaultValue={supplier?.notes ?? ""}
        error={state.fieldErrors?.notes}
      />

      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ الحفظ..." : supplier ? "حفظ التعديلات" : "إضافة المورد"}
      </Button>
    </form>
  );
}
