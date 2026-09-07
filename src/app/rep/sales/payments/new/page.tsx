import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { RecordAccountPaymentForm } from "@/components/admin/accounts/RecordAccountPaymentForm";
import { createRepReplacementPaymentAction } from "@/app/rep/sales/actions";

interface RepSalesNewPaymentPageProps {
  searchParams: Promise<{ replacementFor?: string }>;
}

/** The REP "تسجيل دفعة صحيحة" destination — reached only via a
 * `?replacementFor=<cancelledPaymentId>` link after successfully cancelling
 * one of THIS rep's own MANUAL payments. Deliberately correction-scoped,
 * NOT a general "record any payment for any merchant" surface — opening
 * this route with no `replacementFor` (or a tampered/ineligible one) shows
 * a blocked state, never a working blank form.
 *
 * Deliberately does NOT require the merchant to still be assigned to this
 * rep (unlike RecordMerchantPaymentForm's own /rep/merchants/[merchantId]
 * flow) — REP payment ownership for a correction is based purely on
 * AccountPayment.createdById (the persisted actual collector), never on
 * current merchant assignment, which can change after the fact. The
 * account paid into is ALWAYS derived here from the original payment's own
 * accountId — never from a query param or form field.
 *
 * This page's own eligibility check is a UX convenience only; the real
 * enforcement is createRepReplacementPaymentAction's own identical re-check
 * at submission time (see its doc comment in src/app/rep/sales/actions.ts). */
export default async function RepSalesNewPaymentPage({ searchParams }: RepSalesNewPaymentPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { replacementFor } = await searchParams;

  const original = replacementFor
    ? await prisma.accountPayment.findUnique({
        where: { id: replacementFor },
        select: {
          id: true,
          createdById: true,
          origin: true,
          cancellation: { select: { id: true } },
          correctedBy: { select: { id: true } },
          account: { select: { id: true, displayName: true, merchant: { select: { businessName: true } } } },
        },
      })
    : null;

  const isOwnPayment = original?.createdById === user.id;

  const blockedReason = !replacementFor
    ? "لا يمكن فتح هذه الصفحة مباشرة — الرجاء الوصول إليها من خلال رابط \"تسجيل دفعة صحيحة\" بعد إلغاء دفعة."
    : !original
      ? "الدفعة الأصلية غير موجودة."
      : !isOwnPayment
        ? "لا يمكنك تصحيح هذه الدفعة."
        : original.origin === ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL
          ? "هذه الدفعة مرتبطة بمبيعة. يجب تصحيح المبيعة الأصلية."
          : original.origin !== ACCOUNT_PAYMENT_ORIGINS.MANUAL
            ? "دفعة قديمة غير مصنفة المصدر — لا يمكن إلغاؤها أو تصحيحها تلقائياً بأمان."
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
          <Link href="/rep/sales" className="text-sm text-gold-champagne hover:underline">
            العودة إلى مبيعاتي ودفعاتي
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>بيانات الدفعة</CardTitle>
        </CardHeader>
        <CardContent>
          {!blockedReason && original ? (
            <RecordAccountPaymentForm replacementFor={original.id} action={createRepReplacementPaymentAction} />
          ) : (
            <p className="text-sm text-neutral-bg/60">{blockedReason}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
