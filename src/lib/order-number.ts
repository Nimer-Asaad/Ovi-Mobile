import "server-only";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Palestine's IANA timezone — the daily reset boundary for OVI order
 * numbers must follow this LOCAL business date, never the server process's
 * own timezone and never a hardcoded offset (Palestine observes DST, so a
 * fixed +2/+3 shift would be wrong roughly half the year). Resolved via
 * Intl's built-in IANA tz database support (Node's ICU, no date/timezone
 * library dependency needed) for "what is today's date", and via Postgres's
 * own `AT TIME ZONE` (see generateDailyOrderNumber) for reinterpreting
 * already-stored timestamps — never the same hardcoded-offset mistake in
 * either direction. */
const BUSINESS_TIMEZONE = "Asia/Hebron";

/** A hard ceiling on how many already-taken candidate numbers this will
 * step past for one call — see the collision-advance loop below. Sized far
 * beyond anything a single real business day could ever produce; hitting
 * it means something is structurally wrong, not a plausible real case. */
const MAX_COLLISION_ADVANCE_ATTEMPTS = 10_000;

/** Today's business-local (Asia/Hebron) calendar date, as both the
 * "YYYYMMDD" stamp used in the order number/advisory-lock key and the
 * "YYYY-MM-DD" form Postgres expects for a `::date` comparison. Computed
 * from Node's own accurate, genuinely-UTC-based `Date` — this half of the
 * problem ("what day is it right now in Palestine") was never affected by
 * how the database happens to store `createdAt`; only reading BACK already-
 * stored timestamps needed the fix below. */
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

/** Generates the next sequential OVI-YYYYMMDD-NNNN order number for TODAY
 * (Asia/Hebron business date) — the ONE shared generator every order-
 * creation path uses (rep sale, admin-for-rep, admin manual order,
 * merchant/web checkout — see createRepSaleCore/rep-sales.ts,
 * admin/orders/new/actions.ts, checkout/actions.ts), so none of them can
 * drift onto a different format or a different notion of "today."
 *
 * MUST be called with an ACTIVE transaction client, and the Order it
 * produces this number for must be created inside that SAME transaction —
 * see the concurrency note below for why.
 *
 * ── HOW EXISTING ORDERS ARE COUNTED (read this before touching the SQL) ──
 * orders.createdAt is Postgres TIMESTAMP(3) WITHOUT TIME ZONE, populated by
 * the column's own DEFAULT CURRENT_TIMESTAMP — it carries no timezone tag,
 * and PRODUCTION HAS BEEN DIRECTLY VERIFIED (read-only) to NOT store UTC
 * wall-clock values: at the moment CURRENT_TIMESTAMP read "2026-09-06
 * 12:54:09+02" (i.e. 10:54 UTC / 13:54 Asia/Hebron), the value actually
 * written into a `timestamp without time zone` column was "2026-09-06
 * 12:54:09" — the database SESSION's own local wall clock at insert time,
 * not UTC. Comparing that naive value directly against a JS-computed UTC
 * instant (this file's previous implementation) was therefore wrong by
 * whatever that session's offset from UTC happens to be.
 *
 * The fix asks Postgres itself to reverse that conversion, using its own
 * live session timezone setting rather than any hardcoded offset:
 *
 *   (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date
 *
 * Read right-to-left on the inner expression: `"createdAt" AT TIME ZONE
 * current_setting('TIMEZONE')` takes the naive stored value and, applying
 * TIMEZONE (a naive->tz conversion when the left side has no zone),
 * *reinterprets* it as having been recorded in the session's own configured
 * zone — recovering the true absolute instant (10:54 UTC in the example
 * above), exactly as production evidence showed. Applying `AT TIME ZONE
 * 'Asia/Hebron'` to THAT result (now a tz->naive conversion, since the left
 * side is already an absolute instant) converts it to Palestine wall-clock
 * (13:54) as a plain timestamp, and `::date` takes just its calendar date.
 * `current_setting('TIMEZONE')` is read fresh on every query — never a
 * hardcoded zone name/offset — so this keeps working correctly even if the
 * session timezone's own DST rules shift the effective offset, and needs no
 * assumption about what that zone actually is.
 *
 * KNOWN, HONEST LIMITATION: this necessarily assumes every existing row was
 * written under the SAME session-timezone convention `current_setting
 * ('TIMEZONE')` reads right now — the naive column carries no per-row
 * timezone metadata at all, so there is no way to verify that historically
 * from the data itself. This code deliberately does NOT run `SET TIME ZONE`
 * anywhere (that would make new rows use a different wall-clock convention
 * than old ones, corrupting this exact interpretation going forward) and
 * deliberately does NOT start supplying `createdAt` manually on new Orders
 * (that would split old and new rows onto two different storage
 * conventions within the same untyped column) — Order.createdAt generation
 * is completely unchanged, still the column's own DEFAULT.
 *
 * THE SUFFIX IS AN ORDINAL, NOT A DERIVATIVE OF OLD NUMBERS: it represents
 * "the Nth order created this business day," computed as
 * COUNT(orders belonging to today's Palestine date) + 1 — deliberately NOT
 * based on the highest existing numeric suffix for today's date prefix:
 * pre-existing orders from the old OVI-YYYYMMDD-RANDOM format carry a
 * 4-digit RANDOM number with no ordinal meaning at all (e.g.
 * "OVI-20260906-8274" was never the 8274th sale of that day), so taking
 * their MAX and adding 1 would jump the counter to a nonsensical value on
 * the very first day this ships. Old orders DO still count toward today's
 * total (their createdAt still resolves to today's Palestine date via the
 * conversion above), which is exactly the required transition behavior: if
 * 3 legacy-numbered orders already exist today, the next one is correctly
 * "#4."
 *
 * CONCURRENCY SAFETY: acquires a Postgres advisory lock scoped to the
 * calling transaction (pg_advisory_xact_lock — automatically released at
 * COMMIT or ROLLBACK, never needs a manual unlock, never leaks if the
 * transaction throws) keyed by today's date, BEFORE counting. Two
 * concurrent sales on the same business day always serialize on this lock:
 * whichever transaction acquires it first counts today's orders and
 * creates its own Order (still inside that same transaction, so the new
 * row is only visible to whoever acquires the lock next) before the second
 * transaction's lock acquisition can even proceed — so two simultaneous
 * sales can never observe the same count and can never receive the same
 * NNNN. This needed no new schema/table: a Postgres advisory lock requires
 * no supporting table, only a numeric key (today's date stamp, e.g.
 * 20260906 — always well under the bigint range, and never collides with
 * any other advisory lock in this app, since none currently exist).
 *
 * The existing @unique constraint on Order.orderNumber, and each caller's
 * own retry-on-P2002 loop, remain as defense-in-depth on top of this —
 * neither was removed.
 *
 * RARE LEGACY-COLLISION HANDLING: an old random 4-digit suffix could, in
 * principle, already equal today's freshly-computed ordinal (e.g. the 1000th
 * sale of the day computes "1000", but some earlier legacy order that same
 * day already happens to be "OVI-20260906-1000" purely by random chance).
 * Still holding the advisory lock, this checks whether the candidate number
 * already exists and, only in that rare case, advances to the next integer
 * and checks again, repeating until a free number is found — never falling
 * back to MAX-of-random, and never creating a silent duplicate. After the
 * first fully-new business day (no more legacy rows for that date), this
 * loop body never runs more than zero times: normal 0001, 0002, 0003, ...
 * progression is then exact. */
export async function generateDailyOrderNumber(tx: Tx): Promise<string> {
  const { stamp, iso } = getBusinessDateStamp(new Date());
  const prefix = `OVI-${stamp}-`;

  const lockKey = BigInt(stamp);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS "count"
    FROM "orders"
    WHERE (
      ("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE ${BUSINESS_TIMEZONE}
    )::date = ${iso}::date
  `;

  const existingCountToday = Number(rows[0]?.count ?? 0n);
  let sequence = existingCountToday + 1;
  let candidate = `${prefix}${String(sequence).padStart(4, "0")}`;

  // Only ever iterates when a legacy random suffix happens to already equal
  // today's computed ordinal — see the doc comment above. findUnique here is
  // safe against races from OTHER new orders because we're still holding
  // today's advisory lock; the only rows that can possibly already exist are
  // ones that existed before this call started.
  for (let attempts = 0; attempts < MAX_COLLISION_ADVANCE_ATTEMPTS; attempts += 1) {
    const existing = await tx.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!existing) {
      return candidate;
    }
    sequence += 1;
    candidate = `${prefix}${String(sequence).padStart(4, "0")}`;
  }

  throw new Error(`generateDailyOrderNumber: exhausted ${MAX_COLLISION_ADVANCE_ATTEMPTS} candidate numbers for ${stamp}`);
}
