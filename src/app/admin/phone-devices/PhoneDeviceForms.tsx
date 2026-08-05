"use client";

import { useActionState } from "react";
import { createPhoneBrand, createPhoneModel, type PhoneDeviceState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

const initial: PhoneDeviceState = {};
function Message({ state }: { state: PhoneDeviceState }) {
  if (state.error) return <p className="text-sm text-rose-500">{state.error}</p>;
  if (state.success) return <p className="text-sm text-emerald-500">{state.success}</p>;
  return null;
}

export function PhoneBrandForm() {
  const [state, action, pending] = useActionState(createPhoneBrand, initial);
  return <form action={action} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-5">
    <h3 className="font-semibold text-neutral-bg">إضافة ماركة هاتف</h3>
    <Input name="name" label="الاسم (مثال: Apple)" required />
    <Input name="nameAr" label="الاسم بالعربية (اختياري)" />
    <Message state={state} /><Button disabled={pending} className="self-start">{pending ? "جارٍ الحفظ..." : "إضافة الماركة"}</Button>
  </form>;
}

export function PhoneModelForm({ brands }: { brands: { id: string; name: string; nameAr: string | null }[] }) {
  const [state, action, pending] = useActionState(createPhoneModel, initial);
  return <form action={action} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-5">
    <h3 className="font-semibold text-neutral-bg">إضافة موديل هاتف</h3>
    <Select name="phoneBrandId" label="ماركة الهاتف" required><option value="">اختر الماركة</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}</Select>
    <Input name="name" label="الموديل (مثال: iPhone 15 Pro)" required />
    <Input name="nameAr" label="الاسم بالعربية (اختياري)" />
    <Message state={state} /><Button disabled={pending} className="self-start">{pending ? "جارٍ الحفظ..." : "إضافة الموديل"}</Button>
  </form>;
}
