import { formatCurrencyFromCents } from "@/lib/utils";
import { getOrderSourceLabel, getPaymentMethodLabel, getPaymentStatusLabel } from "@/lib/order-labels";

export interface InvoiceItem {
  id: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  product: {
    sku: string;
    name: string;
    nameAr: string | null;
  };
}

export interface InvoiceData {
  orderNumber: string;
  createdAt: Date;
  source: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidAmountCents: number;
  contactName: string | null;
  contactPhone: string | null;
  city: string | null;
  shippingAddress: string | null;
  notes: string | null;
  customer: { name: string; email: string } | null;
  merchant: { businessName: string } | null;
  items: InvoiceItem[];
}

/** Pure, server-renderable printable invoice. Deliberately styled as a
 * literal white paper document (not the app's dark navy admin theme) since
 * it's meant to be printed — every field falls back to "—" instead of
 * crashing, so it renders safely for online/wholesale/rep-sale orders too,
 * not only manual ones. Never recalculates prices — every number here is
 * read straight from the saved Order/OrderItem rows. */
export function InvoiceView({ order }: { order: InvoiceData }) {
  const balanceCents = Math.max(order.totalCents - order.paidAmountCents, 0);
  const customerLabel = order.merchant?.businessName ?? order.customer?.name ?? order.contactName ?? "—";

  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">فاتورة بيع</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            رقم الطلب: <span className="font-semibold text-neutral-900">{order.orderNumber}</span>
          </p>
          <p>التاريخ: {new Date(order.createdAt).toLocaleDateString("ar")}</p>
          <p>نوع الطلب: {getOrderSourceLabel(order.source)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات العميل</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">الاسم: </dt>
              <dd className="inline">{customerLabel}</dd>
            </div>
            {order.customer?.email && (
              <div>
                <dt className="inline text-neutral-500">البريد الإلكتروني: </dt>
                <dd className="inline">{order.customer.email}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-neutral-500">الهاتف: </dt>
              <dd className="inline">{order.contactPhone ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">المدينة: </dt>
              <dd className="inline">{order.city ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">العنوان: </dt>
              <dd className="inline">{order.shippingAddress ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات الدفع</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">طريقة الدفع: </dt>
              <dd className="inline">{getPaymentMethodLabel(order.paymentMethod)}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">حالة الدفع: </dt>
              <dd className="inline">{getPaymentStatusLabel(order.paymentStatus)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 text-start">المنتج</th>
              <th className="py-2 text-start">SKU</th>
              <th className="py-2 text-start">الكمية</th>
              <th className="py-2 text-start">سعر الوحدة</th>
              <th className="py-2 text-start">الإجمالي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="py-2 text-neutral-900">{item.product.nameAr ?? item.product.name}</td>
                <td className="py-2 text-neutral-500">{item.product.sku}</td>
                <td className="py-2 text-neutral-700">{item.quantity}</td>
                <td className="py-2 text-neutral-700">{formatCurrencyFromCents(item.unitPriceCents)}</td>
                <td className="py-2 font-medium text-neutral-900">{formatCurrencyFromCents(item.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-col items-end gap-1 border-t border-neutral-200 pt-4 text-sm">
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">المجموع الفرعي</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(order.subtotalCents)}</span>
        </div>
        {order.discountCents > 0 && (
          <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
            <span className="text-neutral-500">الخصم</span>
            <span className="text-neutral-900">-{formatCurrencyFromCents(order.discountCents)}</span>
          </div>
        )}
        <div className="flex w-full max-w-xs items-center justify-between text-base font-semibold sm:w-64">
          <span className="text-neutral-900">الإجمالي</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(order.totalCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">المبلغ المستلم</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(order.paidAmountCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between font-semibold sm:w-64">
          <span className="text-neutral-500">المتبقي</span>
          <span className={balanceCents > 0 ? "text-rose-600" : "text-neutral-900"}>
            {formatCurrencyFromCents(balanceCents)}
          </span>
        </div>
      </div>

      {order.notes && (
        <div className="mt-6 border-t border-neutral-200 pt-4 text-sm">
          <h2 className="font-semibold text-neutral-500">ملاحظات</h2>
          <p className="mt-1 text-neutral-800">{order.notes}</p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-neutral-400">شكراً لتعاملكم مع Ovi Mobile</p>
    </div>
  );
}
