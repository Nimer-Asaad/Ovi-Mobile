import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderStatusLabel } from "@/lib/order-labels";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";

export interface AccountStatementOrder {
  orderNumber: string;
  createdAt: Date;
  status: string;
  totalCents: number;
}

export interface AccountStatementPayment {
  id: string;
  amountCents: number;
  method: string;
  createdAt: Date;
  note: string | null;
}

export interface AccountStatementData {
  displayName: string;
  phone: string | null;
  kindLabel: string;
  orders: AccountStatementOrder[];
  payments: AccountStatementPayment[];
}

/** Pure, server-renderable printable statement — mirrors InvoiceView's
 * literal white-paper convention exactly (not the app's dark navy admin
 * theme, since it's meant to be printed). Every number here is derived from
 * the same live orders/payments the account detail page reads, never a
 * separately stored total. */
export function AccountStatementView({ account }: { account: AccountStatementData }) {
  const activeOrders = account.orders.filter((order) => !isTerminalOrderStatus(order.status));
  const totalInvoicedCents = activeOrders.reduce((sum, order) => sum + order.totalCents, 0);
  const totalPaidCents = account.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const balanceCents = Math.max(totalInvoicedCents - totalPaidCents, 0);

  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">كشف حساب</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            الحساب: <span className="font-semibold text-neutral-900">{account.displayName}</span>
          </p>
          <p>النوع: {account.kindLabel}</p>
          <p>الهاتف: {account.phone ?? "—"}</p>
          <p>تاريخ الإصدار: {new Date().toLocaleDateString("ar")}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <h2 className="text-sm font-semibold text-neutral-500">الطلبات</h2>
        <table className="mt-2 w-full text-start text-sm">
          <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 text-start">رقم الطلب</th>
              <th className="py-2 text-start">الحالة</th>
              <th className="py-2 text-start">التاريخ</th>
              <th className="py-2 text-start">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {account.orders.map((order) => (
              <tr key={order.orderNumber}>
                <td className="py-2 text-neutral-900">{order.orderNumber}</td>
                <td className="py-2 text-neutral-700">{getOrderStatusLabel(order.status)}</td>
                <td className="py-2 text-neutral-700">{new Date(order.createdAt).toLocaleDateString("ar")}</td>
                <td className="py-2 font-medium text-neutral-900">{formatCurrencyFromCents(order.totalCents)}</td>
              </tr>
            ))}
            {account.orders.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-neutral-400">
                  لا توجد طلبات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 overflow-x-auto">
        <h2 className="text-sm font-semibold text-neutral-500">الدفعات</h2>
        <table className="mt-2 w-full text-start text-sm">
          <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 text-start">التاريخ</th>
              <th className="py-2 text-start">الطريقة</th>
              <th className="py-2 text-start">ملاحظة</th>
              <th className="py-2 text-start">المبلغ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {account.payments.map((payment) => (
              <tr key={payment.id}>
                <td className="py-2 text-neutral-700">{new Date(payment.createdAt).toLocaleDateString("ar")}</td>
                <td className="py-2 text-neutral-700">{getAccountPaymentMethodLabel(payment.method)}</td>
                <td className="py-2 text-neutral-700">{payment.note ?? "—"}</td>
                <td className="py-2 font-medium text-neutral-900">{formatCurrencyFromCents(payment.amountCents)}</td>
              </tr>
            ))}
            {account.payments.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-neutral-400">
                  لا توجد دفعات
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-col items-end gap-1 border-t border-neutral-200 pt-4 text-sm">
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">إجمالي الطلبات الفعّالة</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(totalInvoicedCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">إجمالي المدفوع</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(totalPaidCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between text-base font-semibold sm:w-64">
          <span className="text-neutral-900">الرصيد المستحق</span>
          <span className={balanceCents > 0 ? "text-rose-600" : "text-neutral-900"}>
            {formatCurrencyFromCents(balanceCents)}
          </span>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">شكراً لتعاملكم مع Ovi Mobile</p>
    </div>
  );
}
