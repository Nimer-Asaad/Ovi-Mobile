"use client";

import { useActionState, useEffect, useState } from "react";
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

/** `useActionState`'s own `pending` flag is unreliable here: this page's
 * forms are Client Components rendered directly under a Server Component
 * page that re-renders on every `revalidatePath` call inside these actions
 * (createPhoneBrand/createPhoneModel/updatePhoneBrand/updatePhoneModel all
 * call it), and that combination is a documented Next.js 15 regression
 * where `isPending` can stay stuck `true` forever after the action already
 * resolved and `state` already updated — see
 * https://github.com/vercel/next.js/discussions/82289. The action's
 * returned `state` itself always updates correctly (that part isn't
 * affected), so this tracks submission-in-flight independently: `true` from
 * the form's native `submit` event (which only fires once HTML5 validation
 * has already passed, so it never fires for a blocked/invalid submission)
 * until `state` changes to a new value, which happens exactly once per
 * completed action call, success or error alike. */
function useReliableSubmitting(state: PhoneDeviceState) {
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setSubmitting(false);
  }, [state]);
  return [submitting, () => setSubmitting(true)] as const;
}

export function PhoneBrandForm() {
  const [state, action] = useActionState(createPhoneBrand, initial);
  const [submitting, markSubmitting] = useReliableSubmitting(state);
  return <form action={action} onSubmit={markSubmitting} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-5">
    <h3 className="font-semibold text-neutral-bg">إضافة ماركة هاتف</h3>
    <Input name="name" label="الاسم (مثال: Apple)" required />
    <Input name="nameAr" label="الاسم بالعربية (اختياري)" />
    <Input name="sortOrder" type="number" label="ترتيب الظهور (اختياري)" defaultValue={0} />
    <Message state={state} /><Button type="submit" disabled={submitting} className="self-start">{submitting ? "جارٍ الحفظ..." : "إضافة الماركة"}</Button>
  </form>;
}

export function PhoneModelForm({ brands }: { brands: { id: string; name: string; nameAr: string | null }[] }) {
  const [state, action] = useActionState(createPhoneModel, initial);
  const [submitting, markSubmitting] = useReliableSubmitting(state);
  return <form action={action} onSubmit={markSubmitting} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-5">
    <h3 className="font-semibold text-neutral-bg">إضافة موديل هاتف</h3>
    <Select name="phoneBrandId" label="ماركة الهاتف" required><option value="">اختر الماركة</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}</Select>
    <Input name="name" label="الموديل (مثال: iPhone 15 Pro)" required />
    <Input name="nameAr" label="الاسم بالعربية (اختياري)" />
    <Input name="sortOrder" type="number" label="ترتيب الظهور (اختياري)" defaultValue={0} />
    <Message state={state} /><Button type="submit" disabled={submitting} className="self-start">{submitting ? "جارٍ الحفظ..." : "إضافة الموديل"}</Button>
  </form>;
}

export function PhoneBrandEditRow({ brand }: { brand: { id: string; name: string; nameAr: string | null; sortOrder: number } }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updatePhoneBrand.bind(null, brand.id), initial);
  const [submitting, markSubmitting] = useReliableSubmitting(state);

  // Close edit mode only on success — an error must stay visible with the
  // form still open so the admin can see what went wrong and fix it,
  // instead of the row collapsing and silently discarding the message.
  useEffect(() => {
    if (state.success) setEditing(false);
  }, [state]);

  if (!editing) {
    return <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>تعديل</Button>;
  }

  return <form action={action} onSubmit={markSubmitting} className="flex flex-1 flex-wrap items-end gap-2">
    <Input name="name" label="الاسم" defaultValue={brand.name} required className="h-9 w-36" />
    <Input name="nameAr" label="بالعربية" defaultValue={brand.nameAr ?? ""} className="h-9 w-36" />
    <Input name="sortOrder" type="number" label="الترتيب" defaultValue={brand.sortOrder} className="h-9 w-20" />
    <Button type="submit" size="sm" disabled={submitting}>{submitting ? "جارٍ الحفظ..." : "حفظ"}</Button>
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
  const [state, action] = useActionState(updatePhoneModel.bind(null, model.id), initial);
  const [submitting, markSubmitting] = useReliableSubmitting(state);

  useEffect(() => {
    if (state.success) setEditing(false);
  }, [state]);

  if (!editing) {
    return <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>تعديل</Button>;
  }

  return <form action={action} onSubmit={markSubmitting} className="flex flex-1 flex-wrap items-end gap-2">
    <Select name="phoneBrandId" label="الماركة" defaultValue={model.phoneBrandId} className="h-9 w-36">
      {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.nameAr ?? brand.name}</option>)}
    </Select>
    <Input name="name" label="الموديل" defaultValue={model.name} required className="h-9 w-36" />
    <Input name="nameAr" label="بالعربية" defaultValue={model.nameAr ?? ""} className="h-9 w-36" />
    <Input name="sortOrder" type="number" label="الترتيب" defaultValue={model.sortOrder} className="h-9 w-20" />
    <Button type="submit" size="sm" disabled={submitting}>{submitting ? "جارٍ الحفظ..." : "حفظ"}</Button>
    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>إلغاء</Button>
    {state.error && <p className="w-full text-sm text-rose-500">{state.error}</p>}
  </form>;
}
