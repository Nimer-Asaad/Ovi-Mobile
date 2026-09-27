import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getMerchantsForRep } from "@/lib/rep-merchants";
import { formatCurrencyFromCents, formatBusinessDateTime } from "@/lib/utils";
import styles from "./page.module.css";

interface AdminRepMerchantDebtsPageProps {
  params: Promise<{ id: string }>;
}

/** ADMIN-only, read-only "كشف مديونية التجار" — one row per merchant assigned
 * to this rep (Merchant.assignedRepId, via the same getMerchantsForRep
 * bulk helper /admin/reps/[id] and /rep/merchants already use), showing ONLY
 * each merchant's current canonical balance. Never a second balance formula:
 * balanceCents here is getAccountBalanceCents's own result, computed once
 * per merchant inside getMerchantsForRep — this page only filters/sorts/
 * displays it. A single Prisma query for every merchant's account state
 * (opening balance + orders + payments + salesReturns, all narrow-selected),
 * never one query per merchant — see getMerchantsForRep's own doc comment.
 *
 * Merchants with an exactly-zero balance are omitted by default (a
 * collection worklist has no use for a settled account) — every merchant
 * with any non-zero balance is shown, debt (positive) and credit (negative,
 * via the same sign convention formatDebtOrCredit already uses elsewhere)
 * alike, sorted highest debt first. No transaction history, no invoices, no
 * receipts — final balance only. */
export default async function AdminRepMerchantDebtsPage({ params }: AdminRepMerchantDebtsPageProps) {
  await requireRole([ROLES.ADMIN]);
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!rep) notFound();

  const merchants = await getMerchantsForRep(rep.id);
  const rows = merchants.filter((merchant) => merchant.balanceCents !== 0).sort((a, b) => b.balanceCents - a.balanceCents);

  const totalDebtCents = rows.filter((row) => row.balanceCents > 0).reduce((sum, row) => sum + row.balanceCents, 0);
  const totalCreditCents = rows.filter((row) => row.balanceCents < 0).reduce((sum, row) => sum + Math.abs(row.balanceCents), 0);

  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">كشف مديونية التجار</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            المندوب: <span className="font-semibold text-neutral-900">{rep.user.name}</span>
          </p>
          <p>تاريخ الطباعة: {formatBusinessDateTime(new Date())}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">لا توجد أرصدة مستحقة على تجار هذا المندوب حالياً.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-2 pe-2 text-start">#</th>
                <th className="py-2 pe-2 text-start">اسم التاجر</th>
                <th className="py-2 text-start">الرصيد النهائي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((merchant, index) => {
                const isCredit = merchant.balanceCents < 0;
                return (
                  <tr key={merchant.id} className={styles.avoidBreak}>
                    <td className="py-2 pe-2 text-neutral-500">{index + 1}</td>
                    <td className="py-2 pe-2 font-medium text-neutral-900">{merchant.businessName}</td>
                    <td className={isCredit ? "py-2 text-emerald-700" : "py-2 text-neutral-900"} dir="ltr">
                      {formatCurrencyFromCents(Math.abs(merchant.balanceCents))}
                      {isCredit && <span className="ms-1 text-xs text-emerald-700">(دائن)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex flex-col items-end gap-1 border-t border-neutral-200 pt-4 text-sm">
        <div className="flex w-full max-w-xs items-center justify-between gap-3 text-base font-semibold sm:w-64">
          <span className="text-neutral-900">إجمالي المديونية</span>
          <span className="text-neutral-900" dir="ltr">{formatCurrencyFromCents(totalDebtCents)}</span>
        </div>
        {totalCreditCents > 0 && (
          <div className="flex w-full max-w-xs items-center justify-between gap-3 sm:w-64">
            <span className="text-neutral-500">إجمالي الأرصدة الدائنة</span>
            <span className="text-emerald-700" dir="ltr">{formatCurrencyFromCents(totalCreditCents)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
