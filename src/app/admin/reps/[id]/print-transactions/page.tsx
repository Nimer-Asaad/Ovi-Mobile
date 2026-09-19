import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { formatCurrencyFromCents } from "@/lib/utils";
import { loadRepTransactions, parseRepPrintRange } from "@/lib/rep-transactions-print";
import { InvoiceView } from "@/components/admin/orders/InvoiceView";
import { PaymentReceiptView } from "@/components/shared/PaymentReceiptView";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

/** ADMIN-only, read-only combined printable document of one rep's sales
 * invoices + collected payment receipts for a Palestine business-date range.
 * Reuses the exact InvoiceView/PaymentReceiptView the standalone pages use;
 * Print → Save as PDF via the browser, no PDF library. */
export default async function AdminRepPrintTransactionsPage({ params, searchParams }: PageProps) {
  await requireRole([ROLES.ADMIN]);
  const { id } = await params;
  const { from, to } = await searchParams;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });
  if (!rep) notFound();

  const range = parseRepPrintRange(from, to);
  if (!range.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-card border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">{range.error}</p>
        <Link href={`/admin/reps/${rep.id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى صفحة المندوب
        </Link>
      </div>
    );
  }

  const { transactions, totals } = await loadRepTransactions(rep, range.fromIso, range.toIso);

  const summary: [string, string][] = [
    ["اسم المندوب", rep.user.name],
    ["من تاريخ", range.fromIso],
    ["إلى تاريخ", range.toIso],
    ["عدد الفواتير", String(totals.salesCount)],
    ["إجمالي المبيعات", formatCurrencyFromCents(totals.salesTotalCents)],
    ["عدد الدفعات", String(totals.paymentsCount)],
    ["إجمالي الدفعات", formatCurrencyFromCents(totals.paymentsTotalCents)],
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none print:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reps/${rep.id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى صفحة المندوب
        </Link>
        <PrintInventorySheetButton />
      </div>

      <section className="break-inside-avoid rounded-card border border-neutral-200 bg-white p-4 text-neutral-900 print:border-neutral-400">
        <h1 className="mb-3 text-lg font-bold">فواتير ودفعات المندوب</h1>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {summary.map(([label, value]) => (
            <div key={label}>
              <dt className="text-neutral-500">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-neutral-500">الإجماليات لا تشمل الفواتير الملغاة/المرتجعة ولا الدفعات الملغاة.</p>
      </section>

      {transactions.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">لا توجد فواتير أو دفعات في هذه الفترة.</p>
      ) : (
        transactions.map((tx) => (
          <section key={tx.key} className="break-inside-avoid-page print:break-inside-avoid">
            <p className="mb-1 text-sm font-bold text-gold-champagne print:text-neutral-900">{tx.type === "SALE" ? "فاتورة بيع" : "سند قبض"}</p>
            {tx.type === "SALE" ? <InvoiceView order={tx.invoice} /> : <PaymentReceiptView payment={tx.receipt} />}
          </section>
        ))
      )}
    </div>
  );
}
