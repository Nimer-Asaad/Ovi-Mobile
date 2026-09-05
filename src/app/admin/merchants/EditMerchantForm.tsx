"use client";

import { useActionState } from "react";
import { updateMerchant, type UpdateMerchantState } from "./actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

const initialState: UpdateMerchantState = {};

export interface EditMerchantFormValues {
  businessName: string;
  contactName: string | null;
  contactPhone: string;
  whatsappPhone: string | null;
  city: string | null;
  address: string | null;
  region: string | null;
  notes: string | null;
  assignedRepId: string | null;
}

interface EditMerchantFormProps {
  merchantId: string;
  initial: EditMerchantFormValues;
  reps: { id: string; label: string }[];
}

/** Editing a merchant's profile — status and opening balance are
 * deliberately NOT here (see MerchantStatusActions/SetOpeningBalanceForm,
 * each with its own dedicated safety rule); this form is purely the
 * descriptive profile fields, all optional except businessName/
 * contactPhone. updateMerchant (./actions.ts) keeps the linked
 * CustomerAccount's displayName/phone in sync automatically. */
export function EditMerchantForm({ merchantId, initial, reps }: EditMerchantFormProps) {
  const action = updateMerchant.bind(null, merchantId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>تعديل بيانات التاجر</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <Input name="businessName" label="اسم المحل" defaultValue={initial.businessName} required />
          <Input name="contactName" label="اسم صاحب المحل (اختياري)" defaultValue={initial.contactName ?? ""} />
          <Input name="contactPhone" label="رقم الجوال" defaultValue={initial.contactPhone} required />
          <Input name="whatsappPhone" label="رقم واتساب (اختياري)" defaultValue={initial.whatsappPhone ?? ""} />
          <Input name="city" label="المدينة (اختياري)" defaultValue={initial.city ?? ""} />
          <Input name="region" label="المنطقة (اختياري)" defaultValue={initial.region ?? ""} placeholder="مثال: نابلس" />
          <Input name="address" label="العنوان (اختياري)" defaultValue={initial.address ?? ""} />
          <Select name="assignedRepId" label="المندوب المسؤول (اختياري)" defaultValue={initial.assignedRepId ?? ""}>
            <option value="">بدون مندوب</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.label}
              </option>
            ))}
          </Select>
          <Textarea name="notes" label="ملاحظات (اختياري)" defaultValue={initial.notes ?? ""} />

          {state.error && (
            <p className="text-sm text-rose-600" role="alert">
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="text-sm text-emerald-600" role="status">
              {state.success}
            </p>
          )}

          <Button type="submit" disabled={isPending} className="self-start">
            {isPending && <Spinner />}
            {isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
