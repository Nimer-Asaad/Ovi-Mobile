"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { GoogleErrorBanner } from "./GoogleErrorBanner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

const initialState: LoginState = {};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.97 13.97 0 0 1 10.94 24c0-1.45.25-2.86.7-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

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
          <Suspense fallback={null}>
            <div className="mb-4">
              <GoogleErrorBanner />
            </div>
          </Suspense>

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
              <p className="text-sm text-rose-600" role="alert">
                {state.error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "جارٍ الدخول..." : "دخول"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-navy-soft" />
            <span className="text-xs text-neutral-bg/50">أو</span>
            <span className="h-px flex-1 bg-navy-soft" />
          </div>

          <a
            href="/auth/google"
            className="flex w-full items-center justify-center gap-2 rounded-card border border-navy-soft bg-navy-surface px-4 py-2.5 text-sm font-medium text-neutral-bg transition-colors hover:bg-navy-soft/50"
          >
            <GoogleIcon />
            تسجيل الدخول بواسطة Google
          </a>

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
