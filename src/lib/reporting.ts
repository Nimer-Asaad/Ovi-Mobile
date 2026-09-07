import "server-only";
import { prisma } from "@/lib/prisma";
import { resolvePaymentReceiptReference } from "@/lib/account-labels";
import { ORDER_STATUSES } from "@/lib/constants";
import { getValidNextOrderStatuses, isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";

const BUSINESS_TIMEZONE = "Asia/Hebron";

/** Today's Palestine business-local calendar date as "YYYY-MM-DD" — see the
 * identical technique (and its full rationale) in src/lib/order-number.ts. */
export function getBusinessDateIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Default report window when the caller hasn't picked one explicitly — the
 * trailing 30 Palestine calendar days including today, so a sales/payments
 * report always loads a bounded, recent slice by default instead of a rep's
 * or the company's entire lifetime history. Still fully overridable via the
 * page's own date-range filter inputs. */
export function getDefaultReportRange(now: Date = new Date()): { fromIso: string; toIso: string } {
  const toIso = getBusinessDateIso(now);
  const fromIso = getBusinessDateIso(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  return { fromIso, toIso };
}

/** One matching row's id plus its TRUE, unambiguous UTC instant — derived
 * via `"createdAt" AT TIME ZONE current_setting('TIMEZONE')` alone (no
 * second `AT TIME ZONE 'Asia/Hebron'` here — that half happens once, at
 * display time, via formatBusinessDateTime). Naive `timestamp without time
 * zone` columns come back from Prisma mis-tagged as UTC (their raw stored
 * digits, taken verbatim); a `timestamptz` result like this one does NOT
 * have that problem — Prisma/pg parse it as a genuine absolute instant. So
 * `businessCreatedAt.getTime()` is correct and can be fed straight into
 * `Intl.DateTimeFormat({ timeZone: "Asia/Hebron" })` with no double shift. */
interface BusinessDatedId {
  id: string;
  businessCreatedAt: Date;
}

/** Order ids (+ true-UTC createdAt) whose createdAt resolves to a Palestine
 * business date inside [fromIso, toIso] (inclusive). Deliberately returns
 * only these two fields, never the full row — a plain Prisma
 * `findMany({ where: { id: { in: ... } } })` right after this fetches the
 * actual display data via Prisma's easy relation-select syntax, instead of
 * hand-writing merchant/rep joins in raw SQL. Needed because orders.createdAt
 * is a naive `timestamp without time zone` column storing the DB SESSION's
 * own wall clock (production-verified, not UTC — see order-number.ts) — a
 * correct Palestine-date bucket requires the same `AT TIME ZONE
 * current_setting('TIMEZONE')` -> `AT TIME ZONE 'Asia/Hebron'`
 * reinterpretation the order/payment daily-sequence counters already use,
 * never a hardcoded offset and never `SET TIME ZONE`. The WHERE clause here
 * is unchanged from before; only the SELECT list gained businessCreatedAt. */
async function getOrderIdsInRange(fromIso: string, toIso: string, salesRepId?: string): Promise<BusinessDatedId[]> {
  return salesRepId
    ? await prisma.$queryRaw<BusinessDatedId[]>`
        SELECT "id", ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt" FROM "orders"
        WHERE (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${fromIso}::date AND ${toIso}::date
          AND "createdByRepId" = ${salesRepId}
      `
    : await prisma.$queryRaw<BusinessDatedId[]>`
        SELECT "id", ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt" FROM "orders"
        WHERE (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${fromIso}::date AND ${toIso}::date
      `;
}

/** Same technique as getOrderIdsInRange, applied to account_payments.
 * `createdById` scoping here is the ACTUAL persisted collector/creator of
 * the payment (never a merchant's assignedRepId) — see getRepActivityReport's
 * own doc comment for why that distinction matters. */
async function getPaymentIdsInRange(fromIso: string, toIso: string, createdById?: string): Promise<BusinessDatedId[]> {
  return createdById
    ? await prisma.$queryRaw<BusinessDatedId[]>`
        SELECT "id", ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt" FROM "account_payments"
        WHERE (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${fromIso}::date AND ${toIso}::date
          AND "createdById" = ${createdById}
      `
    : await prisma.$queryRaw<BusinessDatedId[]>`
        SELECT "id", ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt" FROM "account_payments"
        WHERE (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${fromIso}::date AND ${toIso}::date
      `;
}

export interface SaleActivityRow {
  type: "SALE";
  key: string;
  createdAt: Date;
  /** TRUE absolute instant (Postgres timestamptz, not the naive/mis-tagged
   * `createdAt` above) — feed this, and only this, to formatBusinessDateTime
   * for display. See BusinessDatedId's doc comment for why. */
  businessCreatedAt: Date;
  documentNumber: string;
  merchantName: string;
  totalCents: number;
  /** Order.paidAmountCents — the real, persisted amount paid AT THE TIME of
   * this sale (never re-derived, never the account's current balance). */
  paidNowCents: number;
  /** Math.max(totalCents - paidNowCents, 0) — this invoice's own remaining
   * balance, the exact same "المتبقي من هذه الفاتورة" convention InvoiceView
   * already uses; never the account's overall debt. */
  remainingCents: number;
  status: string;
  paymentStatus: string;
  repName: string | null;
  href: string;
  /** True when getValidNextOrderStatuses(status, source) currently allows a
   * CANCELLED/RETURNED transition — the same eligibility rule
   * src/lib/sale-correction.ts's correctSale itself re-validates
   * server-side before ever writing anything. Purely a UI hint (show/hide
   * the "تصحيح / إلغاء المبيعة" button) — never trusted as the real
   * authorization boundary. */
  isCorrectable: boolean;
}

export interface PaymentActivityRow {
  type: "PAYMENT";
  key: string;
  /** AccountPayment.id — needed to submit a cancellation (paymentId hidden
   * field), distinct from `key` (a display-safe React key prefix). */
  id: string;
  createdAt: Date;
  /** TRUE absolute instant — see SaleActivityRow.businessCreatedAt. */
  businessCreatedAt: Date;
  /** payment.receiptNumber when present, else the same deterministic legacy
   * fallback the payment receipt page itself uses (resolvePaymentReceiptReference)
   * — never a second, competing fallback format. */
  documentNumber: string;
  merchantName: string;
  amountCents: number;
  method: string;
  note: string | null;
  /** Whoever actually recorded/collected this payment (createdById -> User.name)
   * — an admin or a rep, whichever authenticated user actually submitted it. */
  collectorName: string | null;
  href: string;
  /** AccountPayment.origin — "MANUAL" | "SALE_INITIAL" | null (legacy). See
   * ACCOUNT_PAYMENT_ORIGINS in src/lib/constants.ts and
   * cancelManualPayment's own doc comment (src/lib/payment-correction.ts)
   * for exactly which origin is eligible for direct cancellation. Never
   * inferred from note text — read straight off the persisted column. */
  origin: string | null;
  /** True once this payment has been cancelled/reversed — see
   * AccountPaymentCancellation in schema.prisma. Purely a UI hint (show
   * "ملغاة" instead of a correction button); the real state lives in the
   * database, re-checked server-side by cancelManualPayment itself. */
  isCancelled: boolean;
  /** Set only when origin === SALE_INITIAL (via the persisted
   * sourceOrderId relation — never inferred from note text) — where
   * "صحّح المبيعة الأصلية" should send the user: back to the report,
   * pre-filtered to the linked sale's own order number, where that SALE
   * row's own correction button lives. Never a second, competing
   * correction control on the payment row itself. */
  sourceOrderCorrectionHref: string | null;
  /** Where "تسجيل دفعة صحيحة" sends the user after successfully cancelling
   * THIS payment — built per-row (via buildReplacementHref) so REP goes to
   * their own merchant's payment form and ADMIN/ADMIN_ASSISTANT goes to
   * the report-scoped payment-entry route preselecting this exact
   * account. Only ever shown for origin === MANUAL rows. */
  replacementHref: string;
}

export type ReportActivityRow = SaleActivityRow | PaymentActivityRow;

/** Interleaves sale and payment rows into one chronological (newest-first)
 * list — the only "merge" this report ever does. Sales totals and payment
 * totals are always kept as separate KPIs by the caller; this function only
 * decides display ORDER, never combines their amounts into one figure. */
export function mergeActivityRows(sales: SaleActivityRow[], payments: PaymentActivityRow[]): ReportActivityRow[] {
  return [...sales, ...payments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export interface ActivityTotals {
  salesTotalCents: number;
  salesCount: number;
  paymentsTotalCents: number;
  paymentsCount: number;
}

/** إجمالي المبيعات / إجمالي الدفعات / عدد المبيعات / عدد الدفعات — kept as
 * two entirely separate pairs of KPIs, never combined into one "net" figure
 * (a payment is account cash collection, not a second sale, and never
 * treated as revenue/profit here). Computed from the FULL filtered row set
 * the caller fetched — never just the current page of a paginated view —
 * so the totals always agree with what "الكل" actually contains.
 *
 * ACTIVE-ONLY: a cancelled/returned sale (isTerminalOrderStatus — the same
 * canonical helper transitionOrderStatus/getAccountBalanceCents already
 * use, never a hardcoded CANCELLED/RETURNED check of our own) and a
 * cancelled payment (row.isCancelled) are EXCLUDED from these four totals —
 * they no longer represent valid current business activity, exactly like
 * getAccountBalanceCents already excludes them from the account balance.
 * This never removes anything from the ROWS the caller renders (see
 * mergeActivityRows) — only from these four KPI numbers. The cancellation
 * event itself is never counted as a second payment/sale here. */
export function computeActivityTotals(sales: SaleActivityRow[], payments: PaymentActivityRow[]): ActivityTotals {
  const activeSales = sales.filter((row) => !isTerminalOrderStatus(row.status));
  const activePayments = payments.filter((row) => !row.isCancelled);
  return {
    salesTotalCents: activeSales.reduce((sum, row) => sum + row.totalCents, 0),
    salesCount: activeSales.length,
    paymentsTotalCents: activePayments.reduce((sum, row) => sum + row.amountCents, 0),
    paymentsCount: activePayments.length,
  };
}

export interface ActivityReportFilters {
  fromIso: string;
  toIso: string;
  /** Free-text search across order/receipt number and merchant/contact name
   * — case-insensitive, matches both entity types. */
  search?: string;
  /** SalesRepresentative.id — scopes Orders (createdByRepId). */
  salesRepId?: string;
  /** User.id — scopes AccountPayments (createdById), the actual collector.
   * Deliberately a SEPARATE id space from salesRepId (Order.createdByRepId
   * is a SalesRepresentative.id; AccountPayment.createdById is a User.id) —
   * callers must resolve a rep's own userId themselves when they want "this
   * rep's sales AND this same rep's collected payments" (see both report
   * pages, which do exactly that). */
  collectorUserId?: string;
  /** Merchant.id — scopes Orders (merchantId) and AccountPayments
   * (account.merchantId) to one merchant, applied server-side via the
   * persisted relation on each entity (never inferred from note text). */
  merchantId?: string;
}

const SALE_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  totalCents: true,
  paidAmountCents: true,
  status: true,
  source: true,
  paymentStatus: true,
  contactName: true,
  merchant: { select: { businessName: true } },
  createdByRep: { select: { user: { select: { name: true } } } },
} as const;

/** Fetches Order rows for the report inside [fromIso, toIso] (Palestine
 * business date), optionally scoped to one rep and/or filtered by search
 * text, and converts each into a SaleActivityRow via `buildHref` — supplied
 * by the caller so the exact same function serves both /rep/sales
 * (-> /rep/sales/[orderNumber]) and /admin/reports
 * (-> /admin/orders/[orderNumber]/invoice) without hardcoding either route
 * here. Never rebuilds invoice data beyond what's needed for the report row
 * — the linked page remains the single source of the real invoice. */
export async function fetchSaleActivityRows(
  filters: ActivityReportFilters,
  buildHref: (orderNumber: string) => string,
): Promise<SaleActivityRow[]> {
  const idRows = await getOrderIdsInRange(filters.fromIso, filters.toIso, filters.salesRepId);
  if (idRows.length === 0) return [];
  const businessCreatedAtById = new Map(idRows.map((row) => [row.id, row.businessCreatedAt]));

  const trimmedSearch = filters.search?.trim();
  const orders = await prisma.order.findMany({
    where: {
      id: { in: idRows.map((row) => row.id) },
      ...(filters.merchantId ? { merchantId: filters.merchantId } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { orderNumber: { contains: trimmedSearch, mode: "insensitive" as const } },
              { contactName: { contains: trimmedSearch, mode: "insensitive" as const } },
              { merchant: { businessName: { contains: trimmedSearch, mode: "insensitive" as const } } },
              { merchant: { contactName: { contains: trimmedSearch, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: SALE_ORDER_SELECT,
  });

  return orders.map((order) => {
    const totalCents = order.totalCents;
    const paidNowCents = order.paidAmountCents;
    return {
      type: "SALE" as const,
      key: `sale:${order.orderNumber}`,
      createdAt: order.createdAt,
      // Non-null: idRows is exactly the set of ids this order came from.
      businessCreatedAt: businessCreatedAtById.get(order.id)!,
      documentNumber: order.orderNumber,
      merchantName: order.merchant?.businessName ?? order.contactName ?? "—",
      totalCents,
      paidNowCents,
      remainingCents: Math.max(totalCents - paidNowCents, 0),
      status: order.status,
      isCorrectable: getValidNextOrderStatuses(order.status, order.source).some(
        (next) => next === ORDER_STATUSES.CANCELLED || next === ORDER_STATUSES.RETURNED,
      ),
      paymentStatus: order.paymentStatus,
      repName: order.createdByRep?.user.name ?? null,
      href: buildHref(order.orderNumber),
    };
  });
}

const PAYMENT_SELECT = {
  id: true,
  accountId: true,
  receiptNumber: true,
  createdAt: true,
  amountCents: true,
  method: true,
  note: true,
  origin: true,
  cancellation: { select: { id: true } },
  sourceOrder: { select: { orderNumber: true } },
  createdBy: { select: { name: true } },
  account: {
    select: {
      displayName: true,
      merchantId: true,
      merchant: { select: { businessName: true, contactName: true } },
    },
  },
} as const;

/** The identifiers a payment's own receipt route needs — REP's route is
 * merchant-scoped (/rep/merchants/[merchantId]/payments/[paymentId]), ADMIN's
 * is account-scoped (/admin/accounts/[accountId]/payments/[paymentId]); a
 * caller building either link needs whichever id its own route uses. */
export interface PaymentHrefContext {
  id: string;
  accountId: string;
  merchantId: string | null;
}

/** Fetches AccountPayment rows for the report — the exact same pattern as
 * fetchSaleActivityRows, applied to account_payments. Every AccountPayment
 * is included regardless of whether it was a standalone manual payment or
 * the sale-linked "paid now" portion of a sale — AccountPayment.note is
 * NEVER parsed/inspected to tell them apart; the report simply shows every
 * real payment transaction that belongs to the requested scope. */
export async function fetchPaymentActivityRows(
  filters: ActivityReportFilters,
  buildHref: (payment: PaymentHrefContext) => string,
  /** Same shape as fetchSaleActivityRows's own buildHref — builds the
   * "صحّح المبيعة الأصلية" link for a SALE_INITIAL payment row, pointing
   * back at THIS SAME report pre-filtered to that sale's order number. */
  buildSourceOrderHref: (orderNumber: string) => string,
  /** Builds the "تسجيل دفعة صحيحة" replacement link shown after a MANUAL
   * payment is successfully cancelled — REP's own merchant payment form,
   * or ADMIN/ADMIN_ASSISTANT's report-scoped payment-entry route
   * preselecting this exact account. Reuses the same PaymentHrefContext
   * shape as buildHref (id/accountId/merchantId) — whichever fields the
   * caller's own destination route needs. */
  buildReplacementHref: (payment: PaymentHrefContext) => string,
): Promise<PaymentActivityRow[]> {
  const idRows = await getPaymentIdsInRange(filters.fromIso, filters.toIso, filters.collectorUserId);
  if (idRows.length === 0) return [];
  const businessCreatedAtById = new Map(idRows.map((row) => [row.id, row.businessCreatedAt]));

  const trimmedSearch = filters.search?.trim();
  const payments = await prisma.accountPayment.findMany({
    where: {
      id: { in: idRows.map((row) => row.id) },
      // Legacy rows (receiptNumber === null) still carry a real accountId ->
      // merchantId relation, so this never excludes them — only rows with no
      // persisted merchant on their account would be excluded, same as the
      // unfiltered case already handles via merchantName's own fallback.
      ...(filters.merchantId ? { account: { merchantId: filters.merchantId } } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { receiptNumber: { contains: trimmedSearch, mode: "insensitive" as const } },
              { account: { displayName: { contains: trimmedSearch, mode: "insensitive" as const } } },
              { account: { merchant: { businessName: { contains: trimmedSearch, mode: "insensitive" as const } } } },
              { account: { merchant: { contactName: { contains: trimmedSearch, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: PAYMENT_SELECT,
  });

  return payments.map((payment) => ({
    type: "PAYMENT" as const,
    key: `payment:${payment.id}`,
    id: payment.id,
    createdAt: payment.createdAt,
    // Non-null: idRows is exactly the set of ids this payment came from.
    businessCreatedAt: businessCreatedAtById.get(payment.id)!,
    documentNumber: resolvePaymentReceiptReference(payment),
    merchantName: payment.account.merchant?.businessName ?? payment.account.displayName,
    amountCents: payment.amountCents,
    method: payment.method,
    note: payment.note,
    collectorName: payment.createdBy.name,
    origin: payment.origin,
    isCancelled: Boolean(payment.cancellation),
    sourceOrderCorrectionHref: payment.sourceOrder ? buildSourceOrderHref(payment.sourceOrder.orderNumber) : null,
    href: buildHref({ id: payment.id, accountId: payment.accountId, merchantId: payment.account.merchantId }),
    replacementHref: buildReplacementHref({ id: payment.id, accountId: payment.accountId, merchantId: payment.account.merchantId }),
  }));
}
