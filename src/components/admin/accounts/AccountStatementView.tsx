import { formatCurrencyFromCents } from "@/lib/utils";
import { buildAccountStatementRows, type AccountStatementInput, type AccountStatementRowType } from "@/lib/account-statement";

export type { AccountStatementOrderInput as AccountStatementOrder, AccountStatementPaymentInput as AccountStatementPayment } from "@/lib/account-statement";

export interface AccountStatementData extends AccountStatementInput {
  displayName: string;
  phone: string | null;
  kindLabel: string;
}

const ROW_TYPE_LABELS: Record<AccountStatementRowType, string> = {
  OPENING: "رصيد افتتاحي",
  SALE: "بيع",
  PAYMENT: "دفعة",
  PAYMENT_REVERSAL: "إلغاء دفعة",
};

/** Pure, server-renderable printable statement — mirrors InvoiceView's
 * literal white-paper convention exactly (not the app's dark navy admin
 * theme, since it's meant to be printed). One unified, chronological ledger
 * table (سجل الحساب) — an OPENING row (only when there's a pre-system
 * balance), then every sale (مدين) and payment (دائن), with a running
 * balance computed by buildAccountStatementRows, which is a pure
 * transformation of the exact same openingBalanceCents/orders/payments
 * getAccountBalanceCents (src/lib/accounts.ts) reads — never a second,
 * competing balance calculation. Shared as-is by every caller: the admin
 * account detail page, the admin print-statement page, and the rep's own
 * merchant detail/statement pages. */
export function AccountStatementView({ account }: { account: AccountStatementData }) {
  const rows = buildAccountStatementRows(account);
  const totalInvoicedCents = rows.filter((row) => row.type === "SALE").reduce((sum, row) => sum + row.debitCents, 0);
  // Net of any reversal — a cancelled payment's original creditCents is
  // still summed here (its historical row is never rewritten), then the
  // matching PAYMENT_REVERSAL row's debitCents cancels it back out, so
  // this KPI always agrees with the running balance below.
  const totalPaidCents =
    rows.filter((row) => row.type === "PAYMENT").reduce((sum, row) => sum + row.creditCents, 0) -
    rows.filter((row) => row.type === "PAYMENT_REVERSAL").reduce((sum, row) => sum + row.debitCents, 0);
  const balanceCents = rows.length > 0 ? rows[rows.length - 1]!.balanceCents : account.openingBalanceCents;

  return (
    <div className="mx-auto max-w-4xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">كشف حساب تاجر</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            الحساب: <span className="font-semibold text-neutral-900">{account.displayName}</span>
          </p>
          <p>النوع: {account.kindLabel}</p>
          <p>الهاتف: {account.phone ?? "—"}</p>
          <p>تاريخ الطباعة: {new Date().toLocaleDateString("ar")}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
          <p className="text-xs text-neutral-500">الرصيد الافتتاحي</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatCurrencyFromCents(account.openingBalanceCents)}</p>
        </div>
        <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
          <p className="text-xs text-neutral-500">إجمالي المشتريات</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatCurrencyFromCents(totalInvoicedCents)}</p>
        </div>
        <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
          <p className="text-xs text-neutral-500">إجمالي الدفعات</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatCurrencyFromCents(totalPaidCents)}</p>
        </div>
        <div className="rounded-card border border-neutral-200 bg-neutral-50 p-3 text-center">
          <p className="text-xs text-neutral-500">الرصيد الحالي</p>
          <p className={`mt-1 text-lg font-bold ${balanceCents > 0 ? "text-rose-600" : "text-neutral-900"}`}>
            {formatCurrencyFromCents(Math.max(balanceCents, 0))}
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm">
          <thead className="border-b border-neutral-300 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 pe-2 text-start">التاريخ</th>
              <th className="py-2 pe-2 text-start">النوع</th>
              <th className="py-2 pe-2 text-start">المرجع</th>
              <th className="py-2 pe-2 text-start">البيان</th>
              <th className="py-2 pe-2 text-start">مدين</th>
              <th className="py-2 pe-2 text-start">دائن</th>
              <th className="py-2 text-start">الرصيد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr
                key={row.key}
                className={row.isTerminalOrder || row.isCancelledPayment || row.type === "PAYMENT_REVERSAL" ? "text-neutral-400" : "text-neutral-900"}
              >
                <td className="py-2 pe-2 align-top whitespace-nowrap">{row.date ? new Date(row.date).toLocaleDateString("ar") : "—"}</td>
                <td className="py-2 pe-2 align-top whitespace-nowrap">
                  {ROW_TYPE_LABELS[row.type]}
                  {row.isCancelledPayment && (
                    <span className="ms-1 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                      ملغاة
                    </span>
                  )}
                </td>
                <td className="py-2 pe-2 align-top whitespace-normal break-words">{row.reference}</td>
                <td className="max-w-xs py-2 pe-2 align-top whitespace-normal break-words">{row.description}</td>
                <td className="py-2 pe-2 align-top">{row.debitCents > 0 ? formatCurrencyFromCents(row.debitCents) : "—"}</td>
                <td className="py-2 pe-2 align-top">{row.creditCents > 0 ? formatCurrencyFromCents(row.creditCents) : "—"}</td>
                <td className="py-2 align-top font-medium">{formatCurrencyFromCents(row.balanceCents)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-neutral-400">
                  لا توجد حركات على هذا الحساب بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">شكراً لتعاملكم مع Ovi Mobile</p>
    </div>
  );
}
