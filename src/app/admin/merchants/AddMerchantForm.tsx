"use client";

import { useActionState } from "react";
import { createMerchant, type CreateMerchantState } from "./actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

const initialState: CreateMerchantState = {};

interface AddMerchantFormProps {
  reps: { id: string; label: string }[];
}

export function AddMerchantForm({ reps }: AddMerchantFormProps) {
  const [state, formAction, isPending] = useActionState(createMerchant, initialState);

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>بيانات التاجر</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Input name="businessName" label="اسم التاجر / المحل" required />
          <Input name="contactPhone" label="رقم الهاتف" required />
          <Input name="city" label="المدينة / المنطقة (اختياري)" />
          <Input name="address" label="العنوان (اختياري)" />
          <Input name="region" label="منطقة المندوب (اختياري)" placeholder="مثال: نابلس" />
          <Select name="assignedRepId" label="المندوب المسؤول (اختياري)" defaultValue="">
            <option value="">بدون مندوب</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.label}
              </option>
            ))}
          </Select>

          {state.error && (
            <p className="text-sm text-rose-600" role="alert">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending && <Spinner />}
            {isPending ? "جارٍ الحفظ..." : "إضافة التاجر"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
