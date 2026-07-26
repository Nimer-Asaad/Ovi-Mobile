"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createWalkInAccount, type CreateWalkInAccountState } from "@/app/admin/accounts/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface WalkInAccountOption {
  id: string;
  displayName: string;
  phone: string | null;
}

interface WalkInAccountFormProps {
  existingAccounts: WalkInAccountOption[];
}

const initialState: CreateWalkInAccountState = {};

/** Surfaces possible existing matches by phone/name as the admin types,
 * rather than trying to auto-dedupe transactionally — phone isn't
 * unique-constrained (siblings can share a phone), so this stays a
 * human decision. */
export function WalkInAccountForm({ existingAccounts }: WalkInAccountFormProps) {
  const [state, formAction, isPending] = useActionState(createWalkInAccount, initialState);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");

  const [createLogin, setCreateLogin] = useState(false);
  const [email, setEmail] = useState("");

  const matches = useMemo(() => {
    const needle = phone.trim() || displayName.trim();
    if (needle.length < 3) return [];
    const lowerNeedle = needle.toLowerCase();
    return existingAccounts.filter(
      (account) =>
        account.phone?.toLowerCase().includes(lowerNeedle) ||
        account.displayName.toLowerCase().includes(lowerNeedle),
    );
  }, [existingAccounts, displayName, phone]);

  if (state.generatedCredentials && state.createdAccountId) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-emerald-300/50 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">تم إنشاء حساب الدخول — انسخ هذه البيانات الآن، لن تظهر مرة أخرى:</p>
          <dl className="mt-3 flex flex-col gap-2">
            <div>
              <dt className="text-emerald-700">البريد الإلكتروني</dt>
              <dd className="font-mono text-emerald-950">{state.generatedCredentials.email}</dd>
            </div>
            <div>
              <dt className="text-emerald-700">كلمة المرور</dt>
              <dd className="font-mono text-emerald-950">{state.generatedCredentials.password}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-emerald-800">
            سلّم هذه البيانات للعميل بنفسك (لم تُرسَل بالبريد الإلكتروني تلقائياً).
          </p>
        </div>
        <Link href={`/admin/accounts/${state.createdAccountId}`}>
          <Button className="self-start">الانتقال إلى الحساب</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {matches.length > 0 && (
        <div className="rounded-card border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">حسابات مشابهة موجودة بالفعل — تأكد أن هذا ليس نفس العميل:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {matches.map((account) => (
              <li key={account.id}>
                <Link href={`/admin/accounts/${account.id}`} className="underline hover:no-underline">
                  {account.displayName} {account.phone ? `— ${account.phone}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>بيانات الحساب</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <Input
              name="displayName"
              label="الاسم"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
            <Input
              name="phone"
              label="رقم الهاتف"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
            <Textarea name="notes" label="ملاحظات (اختياري)" />

            <div className="flex flex-col gap-3 rounded-card border border-navy-soft p-3">
              <label className="flex items-center gap-2 text-sm text-neutral-bg">
                <input
                  type="checkbox"
                  name="createLogin"
                  checked={createLogin}
                  onChange={(event) => setCreateLogin(event.target.checked)}
                />
                إنشاء حساب دخول للعميل على التطبيق أيضاً
              </label>
              {createLogin && (
                <Input
                  name="email"
                  type="email"
                  label="البريد الإلكتروني"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              )}
            </div>

            {state.error && (
              <p className="text-sm text-rose-600" role="alert">
                {state.error}
              </p>
            )}

            <Button type="submit" disabled={isPending} className="self-start">
              {isPending && <Spinner />}
              {isPending ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
