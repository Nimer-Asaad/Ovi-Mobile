"use client";

import { useActionState } from "react";
import type { Color } from "@prisma/client";
import { createColor, updateColor, type ColorFormState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface ColorFormProps {
  color?: Color;
}

const initialState: ColorFormState = {};

export function ColorForm({ color }: ColorFormProps) {
  const action = color ? updateColor.bind(null, color.id) : createColor;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Input name="name" label="الاسم" defaultValue={color?.name} required error={state.fieldErrors?.name} />
      <Input
        name="nameAr"
        label="الاسم بالعربية (اختياري)"
        defaultValue={color?.nameAr ?? ""}
        error={state.fieldErrors?.nameAr}
      />
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            name="hexCode"
            label="كود اللون (اختياري)"
            placeholder="#000000"
            defaultValue={color?.hexCode ?? ""}
            error={state.fieldErrors?.hexCode}
          />
        </div>
        {color?.hexCode && (
          <span
            aria-hidden="true"
            className="mb-1 h-10 w-10 shrink-0 rounded-card border border-navy-soft"
            style={{ backgroundColor: color.hexCode }}
          />
        )}
      </div>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ الحفظ..." : color ? "حفظ التعديلات" : "إضافة اللون"}
      </Button>
    </form>
  );
}
