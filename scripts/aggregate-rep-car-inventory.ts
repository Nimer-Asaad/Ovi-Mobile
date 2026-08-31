/**
 * ONE-TIME DATA CONVERSION — NOT run automatically by anything, NOT a
 * Prisma migration. For manual review and manual execution ONLY, during
 * the SAME deploy window as the aggregate-REP_CAR code change
 * (assignStockToRep, completeStockRequest, createRepSaleCore,
 * returnStockFromRep now read/write REP_CAR InventoryItem rows as one
 * plain aggregate row per product — see the InventoryItem doc comment in
 * prisma/schema.prisma).
 *
 * RUN WITH:
 *
 *   node --env-file=.env ./node_modules/.bin/tsx scripts/aggregate-rep-car-inventory.ts
 *
 * (Node 20.6+'s built-in --env-file loads DATABASE_URL from .env for this
 * standalone script — unlike `next dev`/`next build`, a bare `tsx` run does
 * NOT load .env automatically. This repo's minimum supported Node,
 * >=20.11.0 per package.json, already supports --env-file. If your shell
 * already exports DATABASE_URL some other way, `npx tsx
 * scripts/aggregate-rep-car-inventory.ts` alone is fine too.)
 *
 * WHY THIS IS A NODE/PRISMA SCRIPT, NOT RAW SQL:
 * A raw-SQL version of this conversion would need to generate a new
 * InventoryItem.id value for every newly-created aggregate row.
 * InventoryItem.id has NO database-level default (see the CREATE TABLE in
 * prisma/migrations/20260725081512_init/migration.sql) — Prisma generates
 * its cuid()-formatted ids entirely in application code, at insert time,
 * never via a Postgres-side function. A SQL script using gen_random_uuid()
 * would produce a structurally different (UUID-shaped, not cuid-shaped) id
 * — not rejected by the column's own type (it's a plain TEXT primary key,
 * no format CHECK constraint), but inconsistent with every other id in the
 * database, and gen_random_uuid() itself requires either PostgreSQL 13+ or
 * the pgcrypto extension — neither of which this script can confirm is
 * available in production from this environment. Running this through
 * Prisma Client instead sidesteps both problems entirely: ids are
 * generated exactly the same way every other InventoryItem row in this app
 * already gets one (see incrementInventoryUpsert below — the SAME helper
 * assignStockToRep/returnStockFromRep call), with zero extension
 * dependency.
 *
 * PROBLEM THIS SOLVES:
 * Production already has dimensional InventoryItem rows at REP_CAR
 * locations from every prior car load (e.g. "OVI04 / iPhone15 = 10" as its
 * own row, at one rep's location). Once the application code above only
 * reads/writes the PLAIN row (variantId AND deviceColorVariantId both
 * NULL), those existing dimensional rows become invisible to it — the
 * rep's real physical car stock would silently read as zero. This script
 * folds every REP_CAR location's existing dimensional rows into one plain
 * row per product, so the live balance the new code sees is correct from
 * the moment the code deploys.
 *
 * SAFETY:
 *   - EVERYTHING below — finding the REP_CAR locations, reading the target
 *     rows, capturing each pair's "before" aggregate quantity, validating
 *     integer safety, writing the increments, zeroing the old dimensional
 *     rows, and both invariant checks — runs inside ONE Prisma transaction.
 *     Either the whole conversion lands, or none of it does. A thrown error
 *     anywhere inside (including any safety check or either invariant
 *     check) rolls the whole thing back automatically; nothing partial is
 *     ever committed. Doing every read inside the same transaction (rather
 *     than snapshotting "before" numbers outside it first) also means the
 *     invariant checks are comparing against a truly consistent view, not
 *     one that could have drifted if something else touched REP_CAR
 *     inventory in the gap between an outside read and the transaction's
 *     own writes.
 *   - Only ever touches REP_CAR locations — WAREHOUSE's own dimensional
 *     rows are never read or written by anything below.
 *   - Only ever reads/folds rows with quantity > 0 AND (variantId IS NOT
 *     NULL OR deviceColorVariantId IS NOT NULL). A REP_CAR location that
 *     already has a plain row (e.g. a load performed after the code change
 *     already shipped) has that row's quantity correctly ADDED to via
 *     incrementInventoryUpsert, never overwritten or duplicated — proven
 *     per-pair by the PER-PAIR INVARIANT below, not just assumed.
 *   - Old dimensional rows are ZEROED (quantity = 0), never deleted — the
 *     pre-conversion state stays fully inspectable afterward. Every
 *     existing `quantity: { gt: 0 }` filter already used throughout the
 *     app already excludes a zeroed row automatically — nothing needs to
 *     change anywhere else because of this choice.
 *   - Historical StockMovement/RepStockTransferBatch/RepCustomerOrder/
 *     RepCustomerOrderItem/Order/OrderItem rows are NEVER read or written
 *     by anything in this script — the full "which phone models were
 *     loaded into which car" audit trail is completely untouched.
 *   - IDEMPOTENT: running this a second time (accidentally or otherwise)
 *     is a safe no-op. After a successful run, every REP_CAR dimensional
 *     row has quantity = 0, so the `quantity: { gt: 0 }` filter below
 *     matches nothing on a second run — the script logs "no conversion was
 *     required" and exits without writing anything. (If some dimensional
 *     REP_CAR row legitimately gained NEW positive quantity between runs —
 *     e.g. old pre-cutover code was still briefly live — a second run
 *     correctly folds in exactly that new amount and zeroes it, which is
 *     still the right outcome, not a duplication bug.)
 *   - EXPLICIT INTEGER/OVERFLOW SAFETY: InventoryItem.quantity is a
 *     PostgreSQL INTEGER column (max 2,147,483,647). Every pair's
 *     dimensionalTotal is checked for safe-integer/positive/in-range as it
 *     is summed (so a corrupt running total is caught at the exact row that
 *     pushed it out of range, not just at the end), and every pair's
 *     dimensionalTotal, aggregateBefore, and resulting expectedAfter are
 *     re-validated in one dedicated pass over ALL pairs BEFORE any pair's
 *     write runs. A transaction rollback would catch a raw Postgres
 *     "integer out of range" error anyway, but failing here first gives a
 *     precise, actionable message naming the exact product/location instead
 *     of a raw DB error mid-conversion.
 *   - PER-PAIR INVARIANT (the strong check): for every distinct
 *     (productId, locationId) pair touched, this script captures that
 *     exact pair's own aggregate row quantity BEFORE any write
 *     (aggregateBefore, 0 if the row doesn't exist yet), and after writing
 *     re-reads that SAME pair's aggregate row and asserts
 *     aggregateAfter === aggregateBefore + dimensionalTotal. This catches
 *     a bug a grand total alone could hide — e.g. one car losing stock
 *     while a different car gains the same amount would leave the GRAND
 *     total unchanged but would fail this per-pair check immediately.
 *   - GRAND-TOTAL INVARIANT (kept as an additional, coarser safety net on
 *     top of the per-pair one, not instead of it): total REP_CAR quantity
 *     summed across every row — dimensional and plain, at every REP_CAR
 *     location — must be identical before and after. Checked after every
 *     write, inside the same transaction; if it ever differs, the script
 *     throws, aborting and rolling back before anything commits.
 *
 * BEFORE RUNNING:
 *   1. Take a fresh database backup / snapshot.
 *   2. Run scripts/pre-conversion-audit.sql (read-only) first if you want
 *      a human-readable per-location/product breakdown to review before
 *      committing to running this script — it is NOT required by this
 *      script itself (both invariant checks above are self-contained),
 *      just useful for a manual sanity look beforehand.
 *   3. Run this script in the SAME deploy window as the application code
 *      change (running one without the other shows wrong live rep-car
 *      balances for however long they're out of sync).
 *   4. Optionally run scripts/post-conversion-audit.sql afterward for a
 *      final human-readable confirmation.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { incrementInventoryUpsert } from "../src/lib/inventory-transactions";

const prisma = new PrismaClient();

type Tx = Prisma.TransactionClient;

/** PostgreSQL INTEGER's max value — the actual column type behind
 * InventoryItem.quantity (see the CREATE TABLE in
 * prisma/migrations/20260725081512_init/migration.sql). Every quantity this
 * script sums or is about to write is checked against this before any
 * increment runs — see "EXPLICIT INTEGER/OVERFLOW SAFETY" above. */
const PG_INT_MAX = 2_147_483_647;

interface ConversionPair {
  productId: string;
  locationId: string;
  /** Sum of every dimensional row's quantity for this pair — what gets
   * added on top of whatever the pair's plain aggregate row already held.
   * Checked for safe-integer/range after every addition while summing
   * (below) and again in the dedicated pre-write validation pass. */
  dimensionalTotal: number;
  /** The dimensional InventoryItem row ids being folded in, so they can be
   * zeroed (never deleted) once their quantity has been added to the
   * aggregate row. */
  rowIds: string[];
  /** Filled in once the transaction starts reading — this pair's own
   * aggregate row quantity before any write (0 if it doesn't exist yet). */
  aggregateBefore: number;
}

async function getTotalRepCarQuantity(tx: Tx, repCarLocationIds: string[]): Promise<number> {
  const result = await tx.inventoryItem.aggregate({
    where: { locationId: { in: repCarLocationIds } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

async function getAggregateQuantity(tx: Tx, productId: string, locationId: string): Promise<number> {
  const row = await tx.inventoryItem.findFirst({
    where: { productId, locationId, variantId: null, deviceColorVariantId: null },
    select: { quantity: true },
  });
  return row?.quantity ?? 0;
}

async function main(): Promise<void> {
  // `converted` distinguishes "the conversion ran and committed writes"
  // from "there was nothing to convert" so the final log line never claims
  // a commit happened when nothing was actually written.
  const converted = await prisma.$transaction(
    async (tx) => {
      // Moved inside the transaction (previously read before it started) —
      // the entire database view/write sequence for this conversion, from
      // the very first read to the last invariant check, now happens
      // within one transaction boundary.
      const repCarLocations = await tx.stockLocation.findMany({
        where: { type: "REP_CAR" },
        select: { id: true, name: true },
      });
      const repCarLocationIds = repCarLocations.map((location) => location.id);

      if (repCarLocationIds.length === 0) {
        console.log("No REP_CAR locations exist — nothing to convert.");
        return false;
      }

      const totalBefore = await getTotalRepCarQuantity(tx, repCarLocationIds);
      console.log(`REP_CAR locations found: ${repCarLocationIds.length}`);
      console.log(`Total REP_CAR quantity before conversion: ${totalBefore}`);

      const dimensionalRows = await tx.inventoryItem.findMany({
        where: {
          locationId: { in: repCarLocationIds },
          quantity: { gt: 0 },
          OR: [{ variantId: { not: null } }, { deviceColorVariantId: { not: null } }],
        },
        select: { id: true, productId: true, locationId: true, quantity: true },
      });

      if (dimensionalRows.length === 0) {
        console.log("No dimensional REP_CAR rows with positive quantity found — nothing to convert (already converted, or nothing was ever loaded dimensionally). Nothing written.");
        return false;
      }

      const byPair = new Map<string, ConversionPair>();
      for (const row of dimensionalRows) {
        const key = `${row.productId}:${row.locationId}`;
        const existing = byPair.get(key);
        if (existing) {
          existing.dimensionalTotal += row.quantity;
          // Group-sum overflow safety — checked after every addition (not
          // only once at the end) so a corrupt running total is caught at
          // the exact row that pushed it out of range.
          if (!Number.isSafeInteger(existing.dimensionalTotal) || existing.dimensionalTotal > PG_INT_MAX) {
            throw new Error(
              `DIMENSIONAL TOTAL OVERFLOW while summing rows for product ${row.productId} at location ${row.locationId}: running total ${existing.dimensionalTotal} is not a safe integer or exceeds PG_INT_MAX (${PG_INT_MAX}). Aborting — this throw rolls back the whole transaction, so nothing has been committed.`,
            );
          }
          existing.rowIds.push(row.id);
        } else {
          byPair.set(key, { productId: row.productId, locationId: row.locationId, dimensionalTotal: row.quantity, rowIds: [row.id], aggregateBefore: 0 });
        }
      }

      console.log(`Will fold ${dimensionalRows.length} dimensional REP_CAR row(s) across ${byPair.size} distinct (product, location) pair(s) into their plain aggregate row.`);

      // Capture each pair's own aggregate row quantity BEFORE any write —
      // required by the per-pair invariant below, and read inside this same
      // transaction so it can never be stale relative to the writes that
      // follow it.
      for (const pair of byPair.values()) {
        pair.aggregateBefore = await getAggregateQuantity(tx, pair.productId, pair.locationId);
      }

      // EXPLICIT INTEGER/OVERFLOW SAFETY — validated for EVERY pair before
      // ANY pair's write runs (a transaction rollback would catch a raw
      // Postgres "integer out of range" error anyway, but this gives a
      // precise, actionable message naming the exact pair instead).
      for (const pair of byPair.values()) {
        const expectedAfter = pair.aggregateBefore + pair.dimensionalTotal;
        const dimensionalTotalValid = Number.isSafeInteger(pair.dimensionalTotal) && pair.dimensionalTotal > 0 && pair.dimensionalTotal <= PG_INT_MAX;
        const aggregateBeforeValid = Number.isSafeInteger(pair.aggregateBefore) && pair.aggregateBefore >= 0 && pair.aggregateBefore <= PG_INT_MAX;
        const expectedAfterValid = Number.isSafeInteger(expectedAfter) && expectedAfter <= PG_INT_MAX;
        if (!dimensionalTotalValid || !aggregateBeforeValid || !expectedAfterValid) {
          throw new Error(
            `INTEGER SAFETY VIOLATED for product ${pair.productId} at location ${pair.locationId}: aggregateBefore=${pair.aggregateBefore}, dimensionalTotal=${pair.dimensionalTotal}, expectedAfter=${expectedAfter} (PG_INT_MAX=${PG_INT_MAX}). Aborting — this throw rolls back the whole transaction, so nothing has been committed. Do not retry without investigating first.`,
          );
        }
      }
      console.log(`Integer safety holds for all ${byPair.size} pair(s) — proceeding to write.`);

      for (const pair of byPair.values()) {
        // Exact same atomic upsert-or-create helper every other REP_CAR
        // increment in this app uses (assignStockToRep, completeStockRequest,
        // the return flow's warehouse side, etc.) — ADDS to any existing
        // aggregate quantity, never overwrites it, and generates a proper
        // cuid() id if it has to create the row (see the file header for
        // why that matters).
        await incrementInventoryUpsert(tx, { productId: pair.productId, variantId: null, deviceColorVariantId: null, locationId: pair.locationId }, pair.dimensionalTotal);

        // Zero (never delete) every dimensional row just folded in.
        await tx.inventoryItem.updateMany({
          where: { id: { in: pair.rowIds } },
          data: { quantity: 0 },
        });
      }

      // PER-PAIR INVARIANT — the strong check: for every touched pair,
      // its own aggregate row must now equal exactly what it held before
      // plus the dimensional total folded into it. A grand total alone
      // could hide one car losing stock while a different car gains the
      // same amount; this catches that immediately, per pair, before
      // anything commits.
      for (const pair of byPair.values()) {
        const aggregateAfter = await getAggregateQuantity(tx, pair.productId, pair.locationId);
        const expectedAfter = pair.aggregateBefore + pair.dimensionalTotal;
        if (aggregateAfter !== expectedAfter) {
          throw new Error(
            `PER-PAIR INVARIANT VIOLATED for product ${pair.productId} at location ${pair.locationId}: expected aggregate ${expectedAfter} (aggregateBefore ${pair.aggregateBefore} + dimensionalTotal ${pair.dimensionalTotal}), got ${aggregateAfter}. Aborting — this throw rolls back the whole transaction, so nothing has been committed. Do not retry without investigating first.`,
          );
        }
      }
      console.log(`Per-pair invariant holds for all ${byPair.size} pair(s).`);

      // GRAND-TOTAL INVARIANT — an additional, coarser safety net on top
      // of the per-pair check above, not a replacement for it.
      const totalAfter = await getTotalRepCarQuantity(tx, repCarLocationIds);
      if (totalAfter !== totalBefore) {
        throw new Error(
          `GRAND TOTAL INVARIANT VIOLATED: total REP_CAR quantity before (${totalBefore}) does not equal total after (${totalAfter}). Aborting — this throw rolls back the whole transaction, so nothing has been committed. Do not retry without investigating first.`,
        );
      }
      console.log(`Total REP_CAR quantity after conversion: ${totalAfter} (matches before — both invariants hold).`);

      return true;
    },
    { timeout: 120_000 },
  );

  if (converted) {
    console.log("Conversion committed successfully.");
  } else {
    console.log("No conversion was required; nothing was written.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("Conversion FAILED — no changes were committed (the transaction rolled back automatically):");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
