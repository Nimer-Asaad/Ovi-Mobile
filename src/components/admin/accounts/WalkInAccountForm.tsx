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
