"use client";

import { useActionState, useState } from "react";
import { createPhoneBrand, createPhoneModel, updatePhoneBrand, updatePhoneModel, type PhoneDeviceState } from "./actions";
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
    <Input name="sortOrder" type="number" label="ترتيب الظهور (اختياري)" defaultValue={0} />
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
    <Input name="sortOrder" type="number" label="ترتيب الظهور (اختياري)" defaultValue={0} />
    <Message state={state} /><Button disabled={pending} className="self-start">{pending ? "جارٍ الحفظ..." : "إضافة الموديل"}</Button>
  </form>;
}

export function PhoneBrandEditRow({ brand }: { brand: { id: string; name: string; nameAr: string | null; sortOrder: number } }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updatePhoneBrand.bind(null, brand.id), initial);

  if (!editing) {
    return <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>تعديل</Button>;
  }

  return <form action={async (formData) => { await action(formData); setEditing(false); }} className="flex flex-1 flex-wrap items-end gap-2">
    <Input name="name" label="الاسم" defaultValue={brand.name} required className="h-9 w-36" />
    <Input name="nameAr" label="بالعربية" defaultValue={brand.nameAr ?? ""} className="h-9 w-36" />
    <Input name="sortOrder" type="number" label="الترتيب" defaultValue={brand.sortOrder} className="h-9 w-20" />
    <Button type="submit" size="sm" disabled={pending}>{pending ? "جارٍ الحفظ..." : "حفظ"}</Button>
    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>إلغاء</Button>
    {state.error && <p className="w-full text-sm text-rose-500">{state.error}</p>}
  </form>;
}

export function PhoneModelEditRow({
  model,
  brands,
}: {
  model: { id: string; name: string; nameAr: string | null; sortOrder: number; phoneBrandId: string };
  brands: { id: string; name: string; nameAr: string | null }[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updatePhoneModel.bind(null, model.id), initial);

  if (!editing) {
    return <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>تعديل</Button>;
  }

  return <form action={async (formData) => { await action(formData); setEditing(false); }} className="flex flex-1 flex-wrap items-end gap-2">
    <Select name="phoneBrandId" label="الماركة" defaultValue={model.phoneBrandId} className="h-9 w-36">
      {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}
    </Select>
    <Input name="name" label="الموديل" defaultValue={model.name} required className="h-9 w-36" />
    <Input name="nameAr" label="بالعربية" defaultValue={model.nameAr ?? ""} className="h-9 w-36" />
    <Input name="sortOrder" type="number" label="الترتيب" defaultValue={model.sortOrder} className="h-9 w-20" />
    <Button type="submit" size="sm" disabled={pending}>{pending ? "جارٍ الحفظ..." : "حفظ"}</Button>
    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>إلغاء</Button>
    {state.error && <p className="w-full text-sm text-rose-500">{state.error}</p>}
  </form>;
}
