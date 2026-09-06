import { formatCurrencyFromCents } from "@/lib/utils";
import { formatDebtOrCredit } from "@/lib/account-labels";
import { getOrderSourceLabel, getPaymentMethodLabel, getPaymentStatusLabel } from "@/lib/order-labels";

export interface InvoiceItem {
  id: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  color: { name: string; nameAr: string | null } | null;
  phoneBrandSnapshot: string | null;
  phoneModelSnapshot: string | null;
  colorNameSnapshot: string | null;
  variantCodeSnapshot: string | null;
  product: {
    sku: string;
    name: string;
    nameAr: string | null;
  };
}

export interface InvoiceMerchantInfo {
  businessName: string;
  /** Owner/contact name — distinct from businessName, optional (see the
   * Merchant.contactName doc comment in schema.prisma). */
  contactName: string | null;
  contactPhone: string | null;
  whatsappPhone: string | null;
  city: string | null;
  region: string | null;
}

export interface InvoiceAccountPosition {
  previousDebtCents: number;
  debtAfterSaleCents: number;
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
  /** Full merchant profile — null for a non-merchant order (online retail,
   * a manual walk-in/registered-customer sale), in which case the generic
   * "بيانات العميل" card below is shown instead. Never both at once. */
  merchant: InvoiceMerchantInfo | null;
  /** The sales rep who created this sale (createdByRep.user.name) — null
   * for a non-rep order (online checkout, admin office sale). */
  repName: string | null;
  /** Only present when this order carries a tracked debt account
   * (Order.accountId not null) — null for an ordinary untracked sale, in
   * which case the invoice simply omits the "الذمة" rows. Derived via
   * getOrderAccountPosition (src/lib/accounts.ts) — never a second,
   * competing balance calculation. */
  account: InvoiceAccountPosition | null;
  items: InvoiceItem[];
}

/** Pure, server-renderable printable invoice. Deliberately styled as a
 * literal white paper document (not the app's dark navy admin/rep theme)
 * since it's meant to be printed, screenshotted, and shared over WhatsApp —
 * every field falls back to "—" instead of crashing, so it renders safely
 * for online/wholesale/rep-sale/manual orders alike, not only one source.
 * Never recalculates prices — every number here is read straight from the
 * saved Order/OrderItem rows (or, for the account rows, derived from the
 * account's own persisted Orders/AccountPayments via getOrderAccountPosition
 * — never a client-side guess).
 *
 * This is the single source of invoice markup — /admin/orders/[orderNumber]/
 * invoice and /rep/sales/[orderNumber] both render this exact component
 * (via InvoiceActions, which also owns the print/PNG/WhatsApp actions and
 * the DOM node those actions capture), never a duplicated screen/print/
 * image-specific copy. */
export function InvoiceView({ order }: { order: InvoiceData }) {
  const remainingOnInvoiceCents = Math.max(order.totalCents - order.paidAmountCents, 0);
  const customerLabel = order.merchant?.businessName ?? order.customer?.name ?? order.contactName ?? "—";

  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">فاتورة بيع</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            رقم الفاتورة: <span className="font-semibold text-neutral-900">{order.orderNumber}</span>
          </p>
          <p>التاريخ: {new Date(order.createdAt).toLocaleString("ar")}</p>
          <p>نوع الطلب: {getOrderSourceLabel(order.source)}</p>
          {order.repName && <p>المندوب: {order.repName}</p>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {order.merchant ? (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-500">بيانات التاجر</h2>
            <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
              <div>
                <dt className="inline text-neutral-500">اسم المحل: </dt>
                <dd className="inline break-words">{order.merchant.businessName}</dd>
              </div>
              {order.merchant.contactName && (
                <div>
                  <dt className="inline text-neutral-500">جهة التواصل: </dt>
                  <dd className="inline break-words">{order.merchant.contactName}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-neutral-500">الهاتف: </dt>
                <dd className="inline">{order.merchant.contactPhone ?? order.contactPhone ?? "—"}</dd>
              </div>
              {order.merchant.whatsappPhone && (
                <div>
                  <dt className="inline text-neutral-500">واتساب: </dt>
                  <dd className="inline">{order.merchant.whatsappPhone}</dd>
                </div>
              )}
              {(order.merchant.city || order.merchant.region) && (
                <div>
                  <dt className="inline text-neutral-500">المدينة / المنطقة: </dt>
                  <dd className="inline">{[order.merchant.city, order.merchant.region].filter(Boolean).join(" / ")}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-500">بيانات العميل</h2>
            <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
              <div>
                <dt className="inline text-neutral-500">الاسم: </dt>
                <dd className="inline break-words">{customerLabel}</dd>
              </div>
              {order.customer?.email && (
                <div>
                  <dt className="inline text-neutral-500">البريد الإلكتروني: </dt>
                  <dd className="inline break-words">{order.customer.email}</dd>
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
                <dd className="inline break-words">{order.shippingAddress ?? "—"}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="min-w-0">
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
        <table className="w-full min-w-[28rem] text-start text-sm">
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
                <td className="max-w-[14rem] whitespace-normal break-words py-2 text-neutral-900">
                  {item.product.nameAr ?? item.product.name}
                  {(item.color || item.colorNameSnapshot) && (
                    <span className="text-neutral-500"> — {item.color ? (item.color.nameAr ?? item.color.name) : item.colorNameSnapshot}</span>
                  )}
                  {item.phoneModelSnapshot && <span className="text-neutral-500"> — {item.phoneBrandSnapshot} / {item.phoneModelSnapshot}{item.variantCodeSnapshot ? ` (${item.variantCodeSnapshot})` : ""}</span>}
                </td>
                <td className="py-2 text-neutral-500">{item.product.sku}</td>
                <td className="py-2 text-neutral-700">{item.quantity}</td>
                <td className="whitespace-nowrap py-2 text-neutral-700">{formatCurrencyFromCents(item.unitPriceCents)}</td>
                <td className="whitespace-nowrap py-2 font-medium text-neutral-900">{formatCurrencyFromCents(item.totalCents)}</td>
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
          <span className="text-neutral-900">إجمالي الفاتورة</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(order.totalCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">المبلغ المدفوع الآن</span>
          <span className="text-neutral-900">{formatCurrencyFromCents(order.paidAmountCents)}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between font-semibold sm:w-64">
          <span className="text-neutral-500">المتبقي من هذه الفاتورة</span>
          <span className={remainingOnInvoiceCents > 0 ? "text-rose-600" : "text-neutral-900"}>
            {formatCurrencyFromCents(remainingOnInvoiceCents)}
          </span>
        </div>

        {order.account &&
          (() => {
            const previous = formatDebtOrCredit(order.account.previousDebtCents);
            const after = formatDebtOrCredit(order.account.debtAfterSaleCents);
            return (
              <div className="mt-2 flex w-full max-w-xs flex-col gap-1 border-t border-dashed border-neutral-200 pt-2 sm:w-64">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{previous.label || "الذمة السابقة"}</span>
                  <span className={previous.isCredit ? "text-emerald-600" : "text-neutral-900"}>{previous.amount}</span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span className="text-neutral-900">{after.label || "الذمة بعد البيع"}</span>
                  <span className={after.isCredit ? "text-emerald-600" : "text-rose-600"}>{after.amount}</span>
                </div>
              </div>
            );
          })()}
      </div>

      {order.notes && (
        <div className="mt-6 border-t border-neutral-200 pt-4 text-sm">
          <h2 className="font-semibold text-neutral-500">ملاحظات</h2>
          <p className="mt-1 whitespace-pre-line break-words text-neutral-800">{order.notes}</p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-neutral-400">شكراً لتعاملكم مع Ovi Mobile</p>
    </div>
  );
}
