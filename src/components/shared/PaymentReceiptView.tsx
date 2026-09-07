import { formatCurrencyFromCents, formatBusinessDateTime } from "@/lib/utils";
import { formatDebtOrCredit, getAccountPaymentMethodLabel, resolvePaymentReceiptReference } from "@/lib/account-labels";

export interface PaymentReceiptMerchantInfo {
  businessName: string;
  /** Owner/contact name — distinct from businessName, optional (see the
   * Merchant.contactName doc comment in schema.prisma). */
  contactName: string | null;
  contactPhone: string | null;
  whatsappPhone: string | null;
  city: string | null;
  region: string | null;
}

export interface PaymentReceiptAccountPosition {
  previousBalanceCents: number;
  afterBalanceCents: number;
}

export interface PaymentReceiptData {
  id: string;
  /** The RAW Prisma AccountPayment.createdAt (naive, mis-tagged-as-UTC by
   * Prisma) — kept exactly as before and used ONLY by
   * resolvePaymentReceiptReference's legacy fallback reference, which is
   * deliberately NOT business-timezone-corrected (see its own doc comment
   * in account-labels.ts). Never used for display — see businessCreatedAt
   * below for that. */
  createdAt: Date;
  /** A TRUE, unambiguous UTC instant, resolved via getPaymentBusinessCreatedAt
   * (src/lib/business-time.ts) before building PaymentReceiptData — the
   * ONLY field this component's date/time line reads. See
   * formatBusinessDateTime (src/lib/utils.ts) for the display half. */
  businessCreatedAt: Date;
  /** AccountPayment.receiptNumber — the real, persisted "PAY-YYYYMMDD-NNNN"
   * daily-sequential number (see generateDailyPaymentReceiptNumber in
   * src/lib/payment-number.ts) for every payment created after this field
   * shipped. Null only for a historical row that predates it — never
   * backfilled — in which case resolvePaymentReceiptReference (account-
   * labels.ts) falls back to a non-sequential display-only reference. */
  receiptNumber: string | null;
  amountCents: number;
  method: string;
  note: string | null;
  /** Whoever actually recorded/collected this payment
   * (AccountPayment.createdById -> User.name) — an admin or a sales rep,
   * whichever authenticated user actually submitted it. Naturally covers
   * "the sales representative name when applicable" without branching on
   * role: when a rep recorded it, their name shows here exactly like the
   * account statement's own "استلمها" convention. */
  collectedByName: string | null;
  /** Full merchant profile — null for a payment against a non-merchant
   * account (a walk-in/registered-customer account an admin recorded a
   * payment for), in which case the generic identity fields below are used
   * instead. Never both at once — mirrors InvoiceData's exact duality. */
  merchant: PaymentReceiptMerchantInfo | null;
  /** CustomerAccount.displayName/phone — the fallback identity when
   * `merchant` is null. */
  accountDisplayName: string;
  accountPhone: string | null;
  /** Derived via getPaymentAccountPosition (src/lib/accounts.ts) — never a
   * second, competing balance calculation, and never today's live balance:
   * a HISTORICAL snapshot of the account's position immediately before/
   * after this specific payment. previousBalanceCents/afterBalanceCents
   * are NEVER rewritten by a later cancellation — see `cancellation`
   * below and getPaymentAccountPosition's own doc comment. */
  account: PaymentReceiptAccountPosition;
  /** Present only once this payment has been cancelled/reversed — see
   * AccountPaymentCancellation in schema.prisma. Purely additional display
   * information; never changes amountCents/method/note/receiptNumber or
   * the `account` position above. `cancelledAt` here is already the TRUE,
   * business-corrected instant (see getPaymentCancellationBusinessCancelledAt
   * in src/lib/business-time.ts) — pass it straight to
   * formatBusinessDateTime, never format it a second time. */
  cancellation: { reason: string; cancelledAt: Date; cancelledByName: string | null } | null;
}

/** Pure, server-renderable printable payment receipt — سند قبض. Visually
 * shares InvoiceView's paper-document language (white card, same spacing/
 * typography scale, same print: classes) so it reads as part of the same
 * Ovi Mobile system, but is never mistaken for a sale invoice: it never
 * shows an items table or "فاتورة بيع", only the payment itself and the
 * account's before/after position. Every field falls back to "—" instead of
 * crashing. Never recalculates the payment amount or balance — every number
 * here is read straight from the saved AccountPayment row or derived via
 * getPaymentAccountPosition.
 *
 * This is the single source of receipt markup — the REP and ADMIN receipt
 * pages both render this exact component (via PaymentReceiptActions, which
 * also owns the print/PNG/WhatsApp actions and the DOM node those actions
 * capture), never a duplicated screen/print/image-specific copy. */
export function PaymentReceiptView({ payment }: { payment: PaymentReceiptData }) {
  const reference = resolvePaymentReceiptReference(payment);
  const previous = formatDebtOrCredit(payment.account.previousBalanceCents);
  const after = formatDebtOrCredit(payment.account.afterBalanceCents);

  return (
    <div className="mx-auto max-w-2xl rounded-card border border-neutral-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
            سند قبض
            {payment.cancellation && (
              <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                ملغاة
              </span>
            )}
          </p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            رقم السند: <span className="font-semibold text-neutral-900">{reference}</span>
          </p>
          <p>التاريخ: {formatBusinessDateTime(payment.businessCreatedAt)}</p>
          {payment.collectedByName && <p>بواسطة: {payment.collectedByName}</p>}
        </div>
      </div>

      {payment.cancellation && (
        <div className="mt-4 rounded-card border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">هذه الدفعة ملغاة ولا تُحتسب على رصيد الحساب الحالي.</p>
          <p className="mt-1">سبب الإلغاء: {payment.cancellation.reason}</p>
          {payment.cancellation.cancelledByName && <p>ألغيت بواسطة: {payment.cancellation.cancelledByName}</p>}
          <p>تاريخ الإلغاء: {formatBusinessDateTime(payment.cancellation.cancelledAt)}</p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {payment.merchant ? (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-500">بيانات التاجر</h2>
            <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
              <div>
                <dt className="inline text-neutral-500">اسم المحل: </dt>
                <dd className="inline break-words">{payment.merchant.businessName}</dd>
              </div>
              {payment.merchant.contactName && (
                <div>
                  <dt className="inline text-neutral-500">جهة التواصل: </dt>
                  <dd className="inline break-words">{payment.merchant.contactName}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-neutral-500">الهاتف: </dt>
                <dd className="inline">{payment.merchant.contactPhone ?? "—"}</dd>
              </div>
              {payment.merchant.whatsappPhone && (
                <div>
                  <dt className="inline text-neutral-500">واتساب: </dt>
                  <dd className="inline">{payment.merchant.whatsappPhone}</dd>
                </div>
              )}
              {(payment.merchant.city || payment.merchant.region) && (
                <div>
                  <dt className="inline text-neutral-500">المدينة / المنطقة: </dt>
                  <dd className="inline">{[payment.merchant.city, payment.merchant.region].filter(Boolean).join(" / ")}</dd>
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
                <dd className="inline break-words">{payment.accountDisplayName}</dd>
              </div>
              <div>
                <dt className="inline text-neutral-500">الهاتف: </dt>
                <dd className="inline">{payment.accountPhone ?? "—"}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-500">بيانات الدفعة</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">طريقة الدفع: </dt>
              <dd className="inline">{getAccountPaymentMethodLabel(payment.method)}</dd>
            </div>
            {payment.note && (
              <div>
                <dt className="inline text-neutral-500">ملاحظة: </dt>
                <dd className="inline break-words">{payment.note}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-end gap-1 border-t border-neutral-200 pt-4 text-sm">
        <div className="flex w-full max-w-xs items-center justify-between sm:w-64">
          <span className="text-neutral-500">{previous.label || "الذمة السابقة"}</span>
          <span className={previous.isCredit ? "text-emerald-600" : "text-neutral-900"}>{previous.amount}</span>
        </div>
        <div className="flex w-full max-w-xs items-center justify-between text-base font-semibold sm:w-64">
          <span className="text-neutral-900">قيمة الدفعة</span>
          <span className="text-emerald-600">{formatCurrencyFromCents(payment.amountCents)}</span>
        </div>
        <div className="mt-2 flex w-full max-w-xs items-center justify-between border-t border-dashed border-neutral-200 pt-2 text-base font-semibold sm:w-64">
          <span className="text-neutral-900">{after.label || "الذمة بعد الدفعة"}</span>
          <span className={after.isCredit ? "text-emerald-600" : "text-rose-600"}>{after.amount}</span>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">شكراً لتعاملكم مع Ovi Mobile</p>
    </div>
  );
}
