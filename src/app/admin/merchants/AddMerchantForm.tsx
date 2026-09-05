"use client";

import { useActionState } from "react";
import { createMerchant, type CreateMerchantState } from "./actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
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
          <Input name="businessName" label="اسم المحل" required />
          <Input name="contactName" label="اسم صاحب المحل (اختياري)" />
          <Input name="contactPhone" label="رقم الجوال" required />
          <Input name="whatsappPhone" label="رقم واتساب (اختياري)" />
          <Input name="city" label="المدينة (اختياري)" />
          <Input name="region" label="المنطقة (اختياري)" placeholder="مثال: نابلس" />
          <Input name="address" label="العنوان (اختياري)" />
          <Select name="assignedRepId" label="المندوب المسؤول (اختياري)" defaultValue="">
            <option value="">بدون مندوب</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.label}
              </option>
            ))}
          </Select>
          <div>
            <Input
              name="openingBalanceCents"
              type="number"
              min={0}
              step="0.01"
              label="الرصيد الافتتاحي (اختياري)"
              placeholder="0"
            />
            <p className="mt-1 text-xs text-neutral-bg/50">المديونية السابقة على التاجر قبل بدء استخدام النظام</p>
          </div>
          <Textarea name="notes" label="ملاحظات (اختياري)" placeholder="مثال: عميل قديم" />

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
