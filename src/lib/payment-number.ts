import "server-only";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Palestine's IANA timezone — see the identical constant/rationale in
 * src/lib/order-number.ts (the OVI order-number generator this module
 * mirrors for AccountPayment receipts instead of Orders). */
const BUSINESS_TIMEZONE = "Asia/Hebron";

/** A hard ceiling on how many already-taken candidate numbers this will
 * step past for one call — see the collision-advance loop below. Sized far
 * beyond anything a single real business day could ever produce; hitting
 * it means something is structurally wrong, not a plausible real case. */
const MAX_COLLISION_ADVANCE_ATTEMPTS = 10_000;

/** Today's business-local (Asia/Hebron) calendar date, as both the
 * "YYYYMMDD" stamp used in the receipt number/advisory-lock key and the
 * "YYYY-MM-DD" form Postgres expects for a `::date` comparison. Identical
 * logic to order-number.ts's own getBusinessDateStamp — duplicated rather
 * than imported/shared, since it's a single small pure function and the two
 * modules are otherwise deliberately independent (distinct prefix, distinct
 * table, distinct advisory-lock namespace — see below). */
function getBusinessDateStamp(now: Date): { stamp: string; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { stamp: `${get("year")}${get("month")}${get("day")}`, iso: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Generates the next sequential PAY-YYYYMMDD-NNNN receipt number for TODAY
 * (Asia/Hebron business date) — the ONE shared generator every
 * AccountPayment-creation path uses: standalone ADMIN payments
 * (recordAccountPayment), standalone REP payments (recordMerchantPaymentAsRep),
 * and the sale-linked "paid now" payment (recordInitialAccountPayment, called
 * from inside createRepSaleCore / admin/orders/new/actions.ts). AccountPayment
 * is the one canonical payment-transaction table — every row gets a receipt
 * number, never just a subset inferred from AccountPayment.note or any other
 * unstructured signal (there is no reliable historical marker to distinguish
 * "manual" from "sale-linked" rows, and this deliberately never tries to
 * invent one).
 *
 * MUST be called with an ACTIVE transaction client, and the AccountPayment it
 * produces this number for must be created inside that SAME transaction —
 * see the concurrency note below for why. For the sale-linked path, this
 * reuses the sale's own existing transaction client — never a nested
 * transaction — and always runs AFTER that sale's own
 * generateDailyOrderNumber call (see rep-sales.ts / admin/orders/new/actions.ts),
 * so lock acquisition order across the two modules is always
 * Order-lock-then-Payment-lock, consistently, everywhere — never the
 * reverse in one path and forward in another, which is what would risk a
 * deadlock between two concurrent transactions each holding one lock and
 * waiting on the other.
 *
 * TIMEZONE / COUNTING SQL: byte-for-byte the same proven approach as
 * generateDailyOrderNumber (src/lib/order-number.ts) — account_payments.
 * createdAt is the same Postgres TIMESTAMP(3) WITHOUT TIME ZONE /
 * DEFAULT CURRENT_TIMESTAMP shape as orders.createdAt, storing the DB
 * SESSION's own wall clock at insert time (production-verified, not UTC —
 * see order-number.ts's own doc comment for the exact evidence). The count
 * query reinterprets each row via
 * `(("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE
 * 'Asia/Hebron')::date`, reading the session's live timezone setting fresh
 * on every query — never SET, never hardcoded, never assumed to be UTC —
 * exactly like the order-number fix. createdAt generation itself is
 * completely unchanged, still the column's own DEFAULT.
 *
 * THE SUFFIX IS AN ORDINAL, NOT A DERIVATIVE OF OLD NUMBERS: computed as
 * COUNT(AccountPayment rows belonging to today's Palestine date) + 1 —
 * never MAX(existing receiptNumber suffix). Every historical row (all of
 * which have receiptNumber = NULL, since this field was never backfilled)
 * still counts toward today's total via its createdAt, exactly the same
 * transition behavior as the OVI order-number rollout: if 3 legacy
 * (receiptNumber-less) AccountPayment rows already exist today, the next
 * one is correctly "#4."
 *
 * CONCURRENCY SAFETY: acquires a Postgres advisory lock scoped to the
 * calling transaction (`pg_advisory_xact_lock` via `$executeRaw` — NOT
 * `$queryRaw`, since `pg_advisory_xact_lock` returns void and production
 * already proved `$queryRaw` throws Prisma P2010 trying to deserialize a
 * void result; see the order-number hotfix) — automatically released at
 * COMMIT or ROLLBACK, never needs a manual unlock, never leaks if the
 * transaction throws. Keyed by the NEGATIVE of today's date stamp (e.g.
 * -20260906) — a distinct, non-overlapping namespace from
 * generateDailyOrderNumber's own key (always a POSITIVE date stamp), so
 * payment-receipt numbering and order numbering never contend on the exact
 * same advisory lock, while staying trivially collision-free by
 * construction (one namespace strictly positive, the other strictly
 * negative — they can never produce the same bigint). Two concurrent
 * payments on the same business day always serialize on this lock exactly
 * like Orders do: whichever transaction acquires it first counts today's
 * payments and creates its own AccountPayment (still inside that same
 * transaction) before the second transaction's lock acquisition can even
 * proceed — so two simultaneous payments can never observe the same count
 * and can never receive the same NNNN.
 *
 * The existing @unique constraint on AccountPayment.receiptNumber remains
 * as defense-in-depth on top of this.
 *
 * RARE LEGACY-COLLISION HANDLING: not actually possible for receiptNumber
 * specifically (no historical row has ever had a non-null receiptNumber to
 * collide with), but the same defensive collision-advance loop as
 * generateDailyOrderNumber is kept anyway, for the exact same
 * belt-and-suspenders reason and to remain structurally consistent with it
 * — still holding the advisory lock, checks whether the candidate number
 * already exists and, only if so, advances to the next integer and checks
 * again, repeating until a free number is found. Never falls back to any
 * MAX-based approach. */
export async function generateDailyPaymentReceiptNumber(tx: Tx): Promise<string> {
  const { stamp, iso } = getBusinessDateStamp(new Date());
  const prefix = `PAY-${stamp}-`;

  const lockKey = -BigInt(stamp);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS "count"
    FROM "account_payments"
    WHERE (
      ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE ${BUSINESS_TIMEZONE}
    )::date = ${iso}::date
  `;

  const existingCountToday = Number(rows[0]?.count ?? 0n);
  let sequence = existingCountToday + 1;
  let candidate = `${prefix}${String(sequence).padStart(4, "0")}`;

  for (let attempts = 0; attempts < MAX_COLLISION_ADVANCE_ATTEMPTS; attempts += 1) {
    const existing = await tx.accountPayment.findUnique({ where: { receiptNumber: candidate }, select: { id: true } });
    if (!existing) {
      return candidate;
    }
    sequence += 1;
    candidate = `${prefix}${String(sequence).padStart(4, "0")}`;
  }

  throw new Error(`generateDailyPaymentReceiptNumber: exhausted ${MAX_COLLISION_ADVANCE_ATTEMPTS} candidate numbers for ${stamp}`);
}
