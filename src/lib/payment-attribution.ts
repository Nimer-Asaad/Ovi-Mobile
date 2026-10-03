import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** REP payment ATTRIBUTION (which REP gets commercial credit in reports) —
 * deliberately separate from AccountPayment.createdById, which stays the
 * audit / permission identity ("who physically entered it") everywhere:
 * receipt creator display, statement "استلمها", REP receipt access, REP
 * cancel/replace ownership (lib/payment-correction.ts requireCreatedById).
 * This module is READ-ONLY reporting logic: it never writes anything, never
 * touches balances (getAccountBalanceCents reads payments by accountId only),
 * and never changes createdById/origin/sourceOrderId on any row.
 *
 * ONE definition, used by every REP payment total (/rep/sales, /admin/reports
 * rep filter, the admin REP print report, both AI rep tools). Precedence —
 * a payment is attributed to AT MOST ONE rep, by the first rule that applies:
 *
 *   1. LINKED   origin = SALE_INITIAL AND sourceOrderId -> an order with
 *               createdByRepId  =>  that order's rep, even when an ADMIN
 *               entered the payment (admin-on-behalf sale). The link is
 *               written in the same transaction as the order and the order's
 *               rep is never updated afterwards, so this is stable.
 *   2. LEGACY   strict, symmetric 1:1 match for rows created before the
 *               2026-09-07 migration added origin/sourceOrderId (both NULL):
 *               same accountId, amountCents = order.paidAmountCents, order has
 *               createdByRepId and paidAmountCents > 0, the order has no
 *               linked payment of its own, and the payment was created
 *               0..LEGACY_SALE_PAYMENT_MAX_GAP_SECONDS after the order — AND
 *               exactly ONE candidate order for that payment AND exactly ONE
 *               candidate payment for that order. Anything ambiguous falls
 *               through to rule 3. Reporting only: nothing is written back.
 *   3. CREATOR  the rep whose own userId = createdById (the pre-existing
 *               rule) — so a REP-entered MANUAL payment still counts for that
 *               rep and an ADMIN-entered MANUAL payment counts for nobody.
 *   4. otherwise: unattributed.
 *
 * Never derived from Merchant.assignedRepId (mutable — reassigning a merchant
 * must not move historical payments between reps), phone, merchant name,
 * receipt-number proximity or note text. Cancellation is NOT decided here:
 * each report keeps excluding cancelled payments from its active totals.
 *
 * WHY THE LEGACY GAP IS 5 SECONDS: before 2026-09-07 a REP sale did
 * `tx.order.create` and then `recordInitialAccountPayment` inside the SAME
 * interactive transaction (src/lib/rep-sales.ts as of 8460aee) — two inserts
 * with only a few lightweight statements between them. The six audited
 * 2026-09-01 production cases were milliseconds apart. From 2026-09-06 the
 * payment also generated a receipt number under a transaction-scoped advisory
 * lock, which can wait on a concurrent sale's transaction — seconds at most,
 * never minutes. 5s covers that wait while staying far below any plausible
 * unrelated coincidence; the 1:1 uniqueness rule is the real safeguard. The
 * window is one-sided (payment never precedes its own order). */
export const LEGACY_SALE_PAYMENT_MAX_GAP_SECONDS = 5;

/** Palestine business-time window [lower, upperExclusive) as SQL timestamp
 * expressions, compared against the same business-time conversion
 * reporting.ts uses (naive createdAt -> DB session zone -> Asia/Hebron). */
export interface PaymentAttributionRange {
  lower: Prisma.Sql;
  upperExclusive: Prisma.Sql;
}

/** Inclusive Palestine business DATES (same meaning as the old ::date BETWEEN). */
export function dayRange(fromIso: string, toIso: string): PaymentAttributionRange {
  return {
    lower: Prisma.sql`${fromIso}::date::timestamp`,
    upperExclusive: Prisma.sql`(${toIso}::date + 1)::timestamp`,
  };
}

/** Palestine business date+time; the selected end minute is fully included. */
export function minuteRange(fromIso: string, fromTime: string, toIso: string, toTime: string): PaymentAttributionRange {
  return {
    lower: Prisma.sql`${`${fromIso} ${fromTime}:00`}::timestamp`,
    upperExclusive: Prisma.sql`${`${toIso} ${toTime}:00`}::timestamp + interval '1 minute'`,
  };
}

/** `column` must be a trusted literal column reference (never user input). */
export function businessTimeInRange(column: string, range: PaymentAttributionRange): Prisma.Sql {
  const biz = Prisma.raw(`((${column} AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')`);
  return Prisma.sql`${biz} >= ${range.lower} AND ${biz} < ${range.upperExclusive}`;
}

/** The CTE list (WITHOUT the leading WITH) defining `payment_attribution`
 * (payment_id, rep_id, via, order_id): exactly one row per attributed
 * payment. Callers write `WITH ${paymentAttributionCtes(range)} SELECT ...`
 * and may append their own CTEs after it. Candidate payments/orders are taken
 * from the range padded by one day each side so a legacy pair straddling the
 * range boundary is still matched (and its uniqueness judged) correctly; the
 * caller applies the exact range to the payments it reports. Bulk SQL only —
 * no per-payment queries. */
export function paymentAttributionCtes(range: PaymentAttributionRange): Prisma.Sql {
  const gap = Prisma.raw(String(LEGACY_SALE_PAYMENT_MAX_GAP_SECONDS));
  const paddedPayments = Prisma.sql`((p."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron') >= ${range.lower} - interval '1 day'
      AND ((p."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron') < ${range.upperExclusive} + interval '1 day'`;
  const paddedOrders = Prisma.sql`((o."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron') >= ${range.lower} - interval '1 day'
      AND ((o."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron') < ${range.upperExclusive} + interval '1 day'`;

  return Prisma.sql`
    attr_pay AS (
      SELECT p."id", p."accountId", p."amountCents", p."createdAt", p."origin", p."sourceOrderId", p."createdById"
      FROM "account_payments" p
      WHERE ${paddedPayments}
    ),
    attr_orders AS (
      SELECT o."id", o."accountId", o."paidAmountCents", o."createdAt", o."createdByRepId"
      FROM "orders" o
      WHERE o."createdByRepId" IS NOT NULL AND o."accountId" IS NOT NULL AND o."paidAmountCents" > 0
        AND ${paddedOrders}
        AND NOT EXISTS (SELECT 1 FROM "account_payments" lp WHERE lp."sourceOrderId" = o."id")
    ),
    attr_edges AS (
      SELECT lp."id" AS payment_id, lo."id" AS order_id, lo."createdByRepId" AS rep_id,
             count(*) OVER (PARTITION BY lp."id") AS orders_per_payment,
             count(*) OVER (PARTITION BY lo."id") AS payments_per_order
      FROM attr_pay lp
      JOIN attr_orders lo ON lo."accountId" = lp."accountId" AND lo."paidAmountCents" = lp."amountCents"
        AND lp."createdAt" >= lo."createdAt" AND lp."createdAt" <= lo."createdAt" + (${gap} * interval '1 second')
      WHERE lp."origin" IS NULL AND lp."sourceOrderId" IS NULL
    ),
    payment_attribution AS (
      SELECT DISTINCT ON (u.payment_id) u.payment_id, u.rep_id, u.via, u.order_id
      FROM (
        SELECT p."id" AS payment_id, o."createdByRepId" AS rep_id, 1 AS prio, 'LINKED'::text AS via, o."id" AS order_id
        FROM attr_pay p JOIN "orders" o ON o."id" = p."sourceOrderId"
        WHERE p."origin" = 'SALE_INITIAL' AND o."createdByRepId" IS NOT NULL
        UNION ALL
        SELECT e.payment_id, e.rep_id, 2, 'LEGACY'::text, e.order_id
        FROM attr_edges e WHERE e.orders_per_payment = 1 AND e.payments_per_order = 1
        UNION ALL
        SELECT p."id", r."id", 3, 'CREATOR'::text, NULL::text
        FROM attr_pay p JOIN "sales_representatives" r ON r."userId" = p."createdById"
      ) u
      ORDER BY u.payment_id, u.prio
    )`;
}

export type PaymentAttributionVia = "LINKED" | "LEGACY" | "CREATOR";

export interface AttributedPayment {
  id: string;
  /** TRUE UTC instant (see reporting.ts BusinessDatedId) — feed to formatBusinessDateTime. */
  businessCreatedAt: Date;
  via: PaymentAttributionVia;
  /** The sale this payment belongs to (LINKED / LEGACY only; null for CREATOR). */
  orderId: string | null;
}

/** Payments attributed to ONE rep inside the business-time range — one row
 * per payment, cancelled ones included (each report decides about those). */
export async function getPaymentsAttributedToRep(repId: string, range: PaymentAttributionRange): Promise<AttributedPayment[]> {
  return prisma.$queryRaw<AttributedPayment[]>`
    WITH ${paymentAttributionCtes(range)}
    SELECT pa.payment_id AS "id", (ap."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AS "businessCreatedAt",
           pa.via AS "via", pa.order_id AS "orderId"
    FROM payment_attribution pa
    JOIN attr_pay ap ON ap."id" = pa.payment_id
    WHERE pa.rep_id = ${repId} AND ${businessTimeInRange(`ap."createdAt"`, range)}
  `;
}
