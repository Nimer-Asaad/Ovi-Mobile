"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerMerchant, type RegisterMerchantState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

const initialState: RegisterMerchantState = {};

export default function RegisterMerchantPage() {
  const [state, formAction, isPending] = useActionState(registerMerchant, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-col items-start justify-center gap-1">
          <CardTitle>انضم كتاجر جملة</CardTitle>
          <p className="text-sm text-neutral-bg/60">
            سيتم مراجعة طلبك من قبل فريقنا قبل تفعيل أسعار الجملة
          </p>
        </CardHeader>

        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <Input name="name" label="الاسم الكامل" required error={state.fieldErrors?.name} />
            <Input
              name="email"
              type="email"
              label="البريد الإلكتروني"
              required
              autoComplete="email"
              error={state.fieldErrors?.email}
            />
            <Input name="phone" type="tel" label="رقم الهاتف (اختياري)" error={state.fieldErrors?.phone} />
            <Input
              name="businessName"
              label="اسم النشاط التجاري"
              required
              error={state.fieldErrors?.businessName}
            />
            <Input name="taxId" label="الرقم الضريبي (اختياري)" error={state.fieldErrors?.taxId} />
            <Input
              name="password"
              type="password"
              label="كلمة المرور"
              required
              autoComplete="new-password"
              error={state.fieldErrors?.password}
            />
            <Input
              name="confirmPassword"
              type="password"
              label="تأكيد كلمة المرور"
              required
              autoComplete="new-password"
              error={state.fieldErrors?.confirmPassword}
            />

            {state.error && (
              <p className="text-sm text-rose-400" role="alert">
                {state.error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "جارٍ إرسال الطلب..." : "إرسال طلب الانضمام"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-neutral-bg/60">
            لديك حساب بالفعل؟{" "}
            <Link href="/login" className="text-gold-champagne hover:underline">
              تسجيل الدخول
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
