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

// Print-only, scoped to this route (the <style> unmounts with the page), so
// the standalone invoice/receipt pages keep their own A4-oriented styling.
const A5_PRINT_CSS = `
@page { size: A5 portrait; margin: 6mm; }
@media print {
  html, body { background: #fff !important; }
  /* Block (not flex) in print: forced page breaks on flex items are not
     reliable across browsers, so spacing moves from gap to a sibling margin. */
  .rep-a5-doc { display: block !important; max-width: none !important; }
  .rep-a5-doc > * + * { margin-top: 2mm; }
  .rep-a5-doc .rep-tx { break-inside: avoid; page-break-inside: avoid; }
  /* .rep-break-before is decided per transaction in the render loop below:
     the first transaction (so the summary is its own cover page and every
     invoice page has the same usable area), every sale invoice, and any
     receipt that directly follows a sale. Consecutive standalone receipts do
     NOT get it, so they keep sharing pages. Break-BEFORE only (never
     break-after), so no blank trailing page can follow the last transaction. */
  .rep-a5-doc .rep-break-before { break-before: page; page-break-before: always; margin-top: 0; }
  .rep-a5-doc .rep-customer { border: 2pt solid #000 !important; padding: 2mm 3mm !important; margin-bottom: 2mm !important; line-height: 1.25; }
  .rep-a5-doc .rep-tx > div { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 2mm !important; border: 0 !important; box-shadow: none !important; zoom: 0.82; }
  .rep-a5-doc .rep-tx table { width: 100%; }
  .rep-a5-doc .rep-tx td, .rep-a5-doc .rep-tx th { overflow-wrap: anywhere; }
  .rep-a5-doc .rep-summary { padding: 2mm !important; }
}
`;

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
    ["الفترة", `من ${range.fromIso} إلى ${range.toIso}`],
    ["عدد الفواتير", String(totals.salesCount)],
    ["إجمالي المبيعات", formatCurrencyFromCents(totals.salesTotalCents)],
    ["عدد الدفعات", String(totals.paymentsCount)],
    ["إجمالي الدفعات", formatCurrencyFromCents(totals.paymentsTotalCents)],
  ];

  return (
    <div className="rep-a5-doc mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none print:gap-2" dir="rtl">
      <style>{A5_PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/reps/${rep.id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى صفحة المندوب
        </Link>
        <PrintInventorySheetButton />
      </div>

      <section className="rep-summary break-inside-avoid rounded-card border border-neutral-200 bg-white p-4 text-neutral-900 print:border-neutral-400">
        <h1 className="mb-3 text-lg font-bold print:mb-1 print:text-sm">فواتير ودفعات المندوب</h1>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 print:grid-cols-3 print:gap-x-2 print:gap-y-1 print:text-[10px]">
          {summary.map(([label, value]) => (
            <div key={label}>
              <dt className="text-neutral-500">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-neutral-500 print:mt-1 print:text-[9px]">الإجماليات لا تشمل الفواتير الملغاة/المرتجعة ولا الدفعات الملغاة.</p>
        {totals.embeddedPaymentsCount > 0 && (
          <p className="mt-1 text-xs text-neutral-500 print:text-[9px]">
            الدفعات المسجلة مع الفاتورة ({totals.embeddedPaymentsCount}) مطبوعة داخل فاتورتها ضمن المبلغ المدفوع الآن ولا تظهر كسند قبض مستقل، وهي محسوبة في إجمالي الدفعات أعلاه.
          </p>
        )}
      </section>

      {transactions.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">لا توجد فواتير أو دفعات في هذه الفترة.</p>
      ) : (
        transactions.map((tx, index) => (
          <section
            key={tx.key}
            className={`rep-tx ${tx.type === "SALE" ? "rep-tx-sale" : "rep-tx-payment"} break-inside-avoid ${
              index === 0 || tx.type === "SALE" || transactions[index - 1]?.type === "SALE" ? "rep-break-before" : ""
            }`}
          >
            <p className="mb-1 text-sm font-bold text-gold-champagne print:mb-0 print:text-[11px] print:text-neutral-900">{tx.type === "SALE" ? "فاتورة بيع" : "سند قبض"}</p>
            {tx.type === "SALE" && (
              // Print-report-only banner (InvoiceView is shared and untouched): same
              // name InvoiceView itself resolves for its customer label.
              <p className="rep-customer mb-2 rounded-card border-2 border-neutral-900 bg-white px-4 py-2 text-xl font-extrabold text-neutral-900 print:text-[20px]">
                اسم الزبون: {tx.invoice.merchant?.businessName ?? tx.invoice.customer?.name ?? tx.invoice.contactName ?? "—"}
              </p>
            )}
            {tx.type === "SALE" ? <InvoiceView order={tx.invoice} /> : <PaymentReceiptView payment={tx.receipt} />}
          </section>
        ))
      )}
    </div>
  );
}
