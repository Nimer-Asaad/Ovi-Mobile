import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatBusinessDateTime, formatCurrencyFromCents } from "@/lib/utils";
import { getOrderBusinessCreatedAt } from "@/lib/business-time";
import { getOrderReturnHistory } from "@/lib/sales-returns";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";

interface PageProps {
  params: Promise<{ orderNumber: string; sequence: string }>;
}

export const dynamic = "force-dynamic";

/** سند مردود مبيعات — ADMIN/ADMIN_ASSISTANT printable receipt for ONE
 * return of ANY order (company-wide, unlike the REP's own order-number-
 * scoped equivalent at /rep/sales/[orderNumber]/returns/[sequence] — same
 * "ADMIN already has broader access" reasoning as the admin invoice page).
 * Read-only. */
export default async function AdminSalesReturnReceiptPage({ params }: PageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  const { orderNumber, sequence: sequenceParam } = await params;
  const sequence = Number(sequenceParam);
  if (!Number.isInteger(sequence) || sequence < 1) notFound();

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      contactName: true,
      merchant: { select: { businessName: true, contactPhone: true } },
    },
  });
  if (!order) notFound();

  const history = await getOrderReturnHistory(order.id, order.orderNumber);
  const entry = history.find((row) => row.sequence === sequence);
  if (!entry) notFound();

  const invoiceDate = (await getOrderBusinessCreatedAt(order.orderNumber)) ?? order.createdAt;
  const merchantName = order.merchant?.businessName ?? order.contactName ?? "—";
  const totalUnits = entry.items.reduce((sum, item) => sum + item.quantity, 0);
  const cell = "border border-neutral-400 px-2 py-1";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" dir="rtl">
      <style>{`@page { size: A5 portrait; margin: 8mm; } @media print { html, body { background: #fff !important; } tr { break-inside: avoid; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/orders/${order.orderNumber}/invoice`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى الفاتورة
        </Link>
        <PrintInventorySheetButton />
      </div>

      <div className="rounded-card border border-neutral-200 bg-white p-6 text-neutral-900 print:border-0 print:p-0">
        <div className="mb-4 flex items-start justify-between gap-4 border-b border-neutral-300 pb-3">
          <div>
            <h1 className="text-xl font-bold">Ovi Mobile</h1>
            <p className="text-sm text-neutral-600">سند مردود مبيعات</p>
          </div>
          <div className="text-end text-sm">
            <p className="font-bold">{entry.reference}</p>
            <p className="text-neutral-600">{formatBusinessDateTime(entry.businessCreatedAt)}</p>
            {entry.reversal && <p className="mt-1 font-bold text-rose-600">ملغي / معكوس</p>}
          </div>
        </div>

        {entry.reversal && (
          <p className="mb-4 rounded-card border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">
            تم إلغاء هذا المردود بتاريخ {formatBusinessDateTime(entry.reversal.businessCreatedAt)} بواسطة {entry.reversal.createdByName} — السبب:{" "}
            {entry.reversal.reason}
          </p>
        )}

        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">رقم الفاتورة الأصلية</dt>
            <dd className="font-semibold">{order.orderNumber}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">تاريخ الفاتورة</dt>
            <dd className="font-semibold">{formatBusinessDateTime(invoiceDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">التاجر / العميل</dt>
            <dd className="font-semibold">{merchantName}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">المندوب</dt>
            <dd className="font-semibold">{entry.repName}</dd>
          </div>
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100">
              <th className={`${cell} text-start`}>الصنف</th>
              <th className={`${cell} w-20 text-center`}>الكمية</th>
              <th className={`${cell} w-28 text-center`}>قيمة المردود</th>
            </tr>
          </thead>
          <tbody>
            {entry.items.map((item) => (
              <tr key={item.orderItemId}>
                <td className={cell}>
                  {item.label}
                  {item.bonusQuantity > 0 && <span className="block text-xs text-neutral-500">منها بونص: {item.bonusQuantity}</span>}
                </td>
                <td className={`${cell} text-center`}>{item.quantity}</td>
                <td className={`${cell} text-center`}>{formatCurrencyFromCents(item.creditCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-base font-bold">
          <span>إجمالي الكمية: {totalUnits} قطعة</span>
          <span>إجمالي قيمة المردود: {formatCurrencyFromCents(entry.totalCreditCents)}</span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">تُخصم قيمة المردود من ذمة التاجر. الوحدات المجانية (بونص) تعود للمخزون بدون قيمة مالية.</p>
        {entry.note && <p className="mt-2 text-sm">ملاحظة: {entry.note}</p>}
      </div>
    </div>
  );
}
