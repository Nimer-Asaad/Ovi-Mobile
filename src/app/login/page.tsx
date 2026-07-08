"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex-col items-start justify-center gap-1">
          <CardTitle>تسجيل الدخول</CardTitle>
          <p className="text-sm text-neutral-bg/60">أدخل بياناتك للوصول إلى حسابك</p>
        </CardHeader>

        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <Input name="email" type="email" label="البريد الإلكتروني" required autoComplete="email" />
            <Input
              name="password"
              type="password"
              label="كلمة المرور"
              required
              autoComplete="current-password"
            />

            {state.error && (
              <p className="text-sm text-rose-400" role="alert">
                {state.error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "جارٍ الدخول..." : "دخول"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-neutral-bg/60">
            ليس لديك حساب؟{" "}
            <Link href="/register" className="text-gold-champagne hover:underline">
              سجّل كعميل
            </Link>{" "}
            ·{" "}
            <Link href="/register/merchant" className="text-gold-champagne hover:underline">
              سجّل كتاجر جملة
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
