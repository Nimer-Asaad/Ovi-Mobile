import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { RecordAccountPaymentForm } from "@/components/admin/accounts/RecordAccountPaymentForm";
import { createReplacementPaymentAction } from "@/app/admin/reports/actions";

interface AdminReportsNewPaymentPageProps {
  searchParams: Promise<{ replacementFor?: string }>;
}

/** The ADMIN_ASSISTANT-eligible "تسجيل دفعة صحيحة" destination — reached
 * only via a `?replacementFor=<cancelledPaymentId>` link after successfully
 * cancelling a MANUAL payment. Deliberately correction-scoped, NOT a
 * general "record any payment for any account" surface — opening this
 * route with no `replacementFor` (or a tampered/ineligible one) shows a
 * blocked state, never a working blank form. Does NOT live under
 * /admin/accounts/** (that subtree stays ADMIN-only via its own
 * layout.tsx, untouched by this feature).
 *
 * The account shown/paid into is ALWAYS derived here from the original
 * payment's own accountId — never from a query param or form field an
 * ADMIN_ASSISTANT could tamper to redirect funds to a different account.
 * This page's own eligibility check is a UX convenience only; the real
 * enforcement is createReplacementPaymentAction's own identical re-check at
 * submission time (see its doc comment in src/app/admin/reports/actions.ts). */
export default async function AdminReportsNewPaymentPage({ searchParams }: AdminReportsNewPaymentPageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { replacementFor } = await searchParams;

  const original = replacementFor
    ? await prisma.accountPayment.findUnique({
        where: { id: replacementFor },
        select: {
          id: true,
          origin: true,
          cancellation: { select: { id: true } },
          correctedBy: { select: { id: true } },
          account: { select: { id: true, displayName: true, merchant: { select: { businessName: true } } } },
        },
      })
    : null;

  const blockedReason = !replacementFor
    ? "لا يمكن فتح هذه الصفحة مباشرة — الرجاء الوصول إليها من خلال رابط \"تسجيل دفعة صحيحة\" بعد إلغاء دفعة."
    : !original
      ? "الدفعة الأصلية غير موجودة."
      : original.origin !== ACCOUNT_PAYMENT_ORIGINS.MANUAL
        ? "لا يمكن تسجيل دفعة تصحيحية لهذا النوع من الدفعات."
        : !original.cancellation
          ? "يجب إلغاء الدفعة الأصلية أولاً قبل تسجيل دفعة تصحيحية."
          : original.correctedBy
            ? "تم بالفعل تسجيل دفعة تصحيحية لهذه الدفعة."
            : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <PageHeader
        title="تسجيل دفعة صحيحة"
        subtitle={original ? (original.account.merchant?.businessName ?? original.account.displayName) : undefined}
        actions={
          <Link href="/admin/reports" className="text-sm text-gold-champagne hover:underline">
            العودة إلى التقارير
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>بيانات الدفعة</CardTitle>
        </CardHeader>
        <CardContent>
          {!blockedReason && original ? (
            <RecordAccountPaymentForm replacementFor={original.id} action={createReplacementPaymentAction} />
          ) : (
            <p className="text-sm text-neutral-bg/60">{blockedReason}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
