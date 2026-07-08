"use client";

import { useActionState } from "react";
import type { Brand } from "@prisma/client";
import { createBrand, updateBrand, type BrandFormState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface BrandFormProps {
  brand?: Brand;
}

const initialState: BrandFormState = {};

export function BrandForm({ brand }: BrandFormProps) {
  const action = brand ? updateBrand.bind(null, brand.id) : createBrand;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Input
        name="name"
        label="الاسم"
        defaultValue={brand?.name}
        required
        error={state.fieldErrors?.name}
      />
      <Input
        name="logoUrl"
        label="رابط الشعار (اختياري)"
        placeholder="https://..."
        defaultValue={brand?.logoUrl ?? ""}
        error={state.fieldErrors?.logoUrl}
      />

      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ الحفظ..." : brand ? "حفظ التعديلات" : "إضافة العلامة التجارية"}
      </Button>
    </form>
  );
}
