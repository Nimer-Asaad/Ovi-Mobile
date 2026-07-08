"use client";

import { useActionState } from "react";
import type { Category } from "@prisma/client";
import { createCategory, updateCategory, type CategoryFormState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface CategoryFormProps {
  category?: Category;
}

const initialState: CategoryFormState = {};

export function CategoryForm({ category }: CategoryFormProps) {
  const action = category ? updateCategory.bind(null, category.id) : createCategory;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Input
        name="name"
        label="الاسم"
        defaultValue={category?.name}
        required
        error={state.fieldErrors?.name}
      />
      <Input
        name="nameAr"
        label="الاسم بالعربية (اختياري)"
        defaultValue={category?.nameAr ?? ""}
        error={state.fieldErrors?.nameAr}
      />

      {state.error && (
        <p className="text-sm text-rose-400" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ الحفظ..." : category ? "حفظ التعديلات" : "إضافة القسم"}
      </Button>
    </form>
  );
}
