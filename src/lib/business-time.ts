import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Resolves a persisted Order/AccountPayment's naive `createdAt` column into
 * a real, unambiguous UTC instant — safe to hand straight to
 * `formatBusinessDateTime` (src/lib/utils.ts) for Asia/Hebron display.
 *
 * Both `orders.createdAt` and `account_payments.createdAt` are
 * `timestamp without time zone` columns storing the DB SESSION's own wall
 * clock (production-verified as Europe/Berlin, not UTC). Prisma
 * materializes that naive value into a JS Date by tagging its raw stored
 * digits as UTC verbatim — so `order.createdAt.getTime()` is NOT a real UTC
 * instant, and formatting it directly with `timeZone: "Asia/Hebron"` would
 * shift the displayed time a second time on top of that mis-tagging.
 *
 * `"createdAt" AT TIME ZONE current_setting('TIMEZONE')` undoes the
 * mis-tagging exactly once — the identical technique already
 * production-verified and approved in src/lib/order-number.ts,
 * src/lib/payment-number.ts, and src/lib/reporting.ts's own
 * `businessCreatedAt`. The result is a genuine `timestamptz`, which Prisma
 * parses correctly (no mis-tagging), so the returned Date's `.getTime()` is
 * a real UTC instant. `current_setting('TIMEZONE')` is read fresh from the
 * live DB session on every call — never a hardcoded 'Europe/Berlin', never
 * a hardcoded offset, never `SET TIME ZONE`.
 *
 * Each function below is a fixed, hand-written query naming its own table
 * literally — table names are never interpolated into the SQL string.
 */

/** Order.orderNumber -> the true UTC instant of that order's createdAt, or
 * null if no such order exists (defensive only — every caller has already
 * loaded the order by the time it calls this). Keyed by orderNumber
 * (unique, @unique in schema) rather than id purely so the invoice pages
 * that already have orderNumber on hand don't need to select an extra id
 * field just for this lookup. */
export async function getOrderBusinessCreatedAt(orderNumber: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ businessCreatedAt: Date }[]>`
    SELECT ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt"
    FROM "orders"
    WHERE "orderNumber" = ${orderNumber}
  `;
  return rows[0]?.businessCreatedAt ?? null;
}

/** AccountPayment.id -> the true UTC instant of that payment's createdAt,
 * or null if no such payment exists (defensive only — same reasoning as
 * getOrderBusinessCreatedAt). */
export async function getPaymentBusinessCreatedAt(paymentId: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ businessCreatedAt: Date }[]>`
    SELECT ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt"
    FROM "account_payments"
    WHERE "id" = ${paymentId}
  `;
  return rows[0]?.businessCreatedAt ?? null;
}

/** AccountPayment.id (NOT the cancellation's own id — paymentId is @unique
 * on AccountPaymentCancellation, so every call site that already has the
 * payment's id on hand needs no extra lookup) -> the true UTC instant of
 * that payment's cancellation.cancelledAt, or null if this payment has no
 * cancellation row. Same technique, same reasoning — cancelledAt is
 * exactly as naive/DB-session-tagged as any other createdAt column here,
 * since it's the same plain `DateTime @default(now())` type. Used by the
 * payment receipt's "تاريخ الإلغاء" line. */
export async function getPaymentCancellationBusinessCancelledAt(paymentId: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ businessCancelledAt: Date }[]>`
    SELECT ("cancelledAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCancelledAt"
    FROM "account_payment_cancellations"
    WHERE "paymentId" = ${paymentId}
  `;
  return rows[0]?.businessCancelledAt ?? null;
}

/** OrderStatusHistory.id -> the true UTC instant of that history row's
 * createdAt, or null if no such row exists. Same technique. Used by the
 * cancelled/returned sale invoice's "تاريخ الإلغاء" line (see
 * OrderStatusHistory in schema.prisma — already carries reason/changedBy
 * for every status transition, sale corrections included). */
export async function getOrderStatusHistoryBusinessCreatedAt(historyId: string): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ businessCreatedAt: Date }[]>`
    SELECT ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt"
    FROM "order_status_history"
    WHERE "id" = ${historyId}
  `;
  return rows[0]?.businessCreatedAt ?? null;
}
