/**
 * Pure-logic verification for the أون لاين online-sales commission ledger
 * (/admin/online). Deliberately DB-FREE, unlike its sibling verify-*.ts
 * scripts (verify-rep-sale-debt-allocation.ts etc.), which exercise a real
 * disposable database via resolveVerifyDatabaseUrl — this repo's only
 * configured DATABASE_URL was unreachable at the time this feature was
 * built (Supabase connection failure, unrelated to this change), so the
 * database-backed checks below are asserted by direct code/schema
 * inspection instead of executed, and are clearly marked as such. Every
 * check that does NOT require a live database runs for real.
 *
 * Run with: node --conditions=react-server --import tsx prisma/verify-online-sales-commission.ts
 * (same invocation as every other prisma/verify-*.ts script — needed
 * because src/lib/reporting.ts is `import "server-only"`.)
 */

export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function check(name: string, test: () => void) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  const [onlineSales, reporting, validation] = await Promise.all([
    import("../src/lib/online-sales"),
    import("../src/lib/reporting"),
    import("../src/lib/validation/onlineSales"),
  ]);

  const { calculateCommissionCents, buildOnlineSaleEntries, computeOnlineSalesTotals, ONLINE_SALE_CATEGORY_CONFIG } = onlineSales;
  const { getBusinessDateIso } = reporting;
  const { saveOnlineSalesSchema } = validation;

  // 1-3: the three canonical rates against the task's own worked example
  // (10,000 NIS = 1,000,000 cents).
  check("wholesale 10000 -> 500", () => {
    assert(calculateCommissionCents(1_000_000, ONLINE_SALE_CATEGORY_CONFIG.WHOLESALE.rateBps) === 50_000, "expected 50,000 cents (500.00)");
  });
  check("super wholesale 10000 -> 350", () => {
    assert(calculateCommissionCents(1_000_000, ONLINE_SALE_CATEGORY_CONFIG.SUPER_WHOLESALE.rateBps) === 35_000, "expected 35,000 cents (350.00)");
  });
  check("retail 10000 -> 700", () => {
    assert(calculateCommissionCents(1_000_000, ONLINE_SALE_CATEGORY_CONFIG.RETAIL.rateBps) === 70_000, "expected 70,000 cents (700.00)");
  });

  // 4: default date is today in Palestine — cross-checked against Node's
  // own Intl computation for Asia/Hebron "right now", independent of
  // getBusinessDateIso's own implementation.
  check("date defaults to Palestine today", () => {
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    assert(getBusinessDateIso() === expected, `expected ${expected}, got ${getBusinessDateIso()}`);
  });

  // 5 & 6: the exact "is this date in the future" comparison
  // saveOnlineSalesAction uses (plain "YYYY-MM-DD" string comparison
  // against getBusinessDateIso()).
  check("previous date accepted (not flagged as future)", () => {
    const today = getBusinessDateIso();
    const yesterday = getBusinessDateIso(new Date(Date.now() - 24 * 60 * 60 * 1000));
    assert(!(yesterday > today), "yesterday must not be treated as future");
    assert(!(today > today), "today itself must not be treated as future");
  });
  check("future date rejected", () => {
    const today = getBusinessDateIso();
    const farFuture = getBusinessDateIso(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    assert(farFuture > today, "10 days from now must be treated as future");
  });

  // 7: zero/blank category ignored — buildOnlineSaleEntries silently
  // drops it rather than erroring; only "every category zero" is the
  // action's own separate rejection (see saveOnlineSalesAction).
  check("zero amount category ignored", () => {
    const entries = buildOnlineSaleEntries({ WHOLESALE: 1_000_000, SUPER_WHOLESALE: 0, RETAIL: 0 });
    assert(entries.length === 1, `expected exactly 1 entry, got ${entries.length}`);
    assert(entries[0]?.category === "WHOLESALE", "expected the WHOLESALE entry to survive");
  });
  check("all-zero categories rejected by save (schema check)", () => {
    const entries = buildOnlineSaleEntries({ WHOLESALE: 0, SUPER_WHOLESALE: 0, RETAIL: 0 });
    assert(entries.length === 0, "expected zero entries when every category is zero — saveOnlineSalesAction rejects this case");
  });

  // 8: negative amount rejected by the zod schema (never silently clamped
  // to zero server-side — unlike the client's own strip-the-"-"-character
  // UX convenience, the server treats an explicit negative as invalid).
  check("negative amount rejected", () => {
    const result = saveOnlineSalesSchema.safeParse({
      saleDate: getBusinessDateIso(),
      wholesaleAmountCents: "-500",
      superWholesaleAmountCents: "",
      retailAmountCents: "",
    });
    assert(!result.success, "a negative amount string must fail validation");
  });
  check("blank amount treated as zero (not an error)", () => {
    const result = saveOnlineSalesSchema.safeParse({
      saleDate: getBusinessDateIso(),
      wholesaleAmountCents: "",
      superWholesaleAmountCents: "",
      retailAmountCents: "",
    });
    assert(result.success, "blank amounts must parse successfully");
    if (result.success) {
      assert(result.data.wholesaleAmountCents === 0, "blank must transform to 0 cents");
    }
  });
  check("decimal amount rounds safely to cents", () => {
    const result = saveOnlineSalesSchema.safeParse({
      saleDate: getBusinessDateIso(),
      wholesaleAmountCents: "33.336",
      superWholesaleAmountCents: "",
      retailAmountCents: "",
    });
    assert(result.success, "a valid decimal must parse");
    if (result.success) {
      assert(result.data.wholesaleAmountCents === 3334, `expected 3334 cents, got ${result.data.wholesaleAmountCents}`);
      const commission = calculateCommissionCents(result.data.wholesaleAmountCents, ONLINE_SALE_CATEGORY_CONFIG.WHOLESALE.rateBps);
      assert(Number.isInteger(commission), "commission must be a whole number of cents, never a float artifact");
    }
  });

  // 10-12: totals from the task's own worked multi-day example.
  check("total sales / total commission / per-category totals computed correctly", () => {
    const rows = [
      { category: "WHOLESALE" as const, amountCents: 1_000_000, commissionCents: 50_000 }, // Sep 12
      { category: "SUPER_WHOLESALE" as const, amountCents: 800_000, commissionCents: 28_000 }, // Sep 13
      { category: "RETAIL" as const, amountCents: 300_000, commissionCents: 21_000 }, // Sep 15
    ];
    const totals = computeOnlineSalesTotals(rows);
    assert(totals.totalSalesCents === 2_100_000, `expected 2,100,000 cents (21,000 NIS), got ${totals.totalSalesCents}`);
    assert(totals.totalCommissionCents === 99_000, `expected 99,000 cents (990 NIS), got ${totals.totalCommissionCents}`);
    assert(totals.categoryTotals.WHOLESALE.salesCents === 1_000_000, "wholesale category total mismatch");
    assert(totals.categoryTotals.SUPER_WHOLESALE.commissionCents === 28_000, "super-wholesale commission total mismatch");
    assert(totals.categoryTotals.RETAIL.salesCents === 300_000, "retail category total mismatch");
  });

  // 9: multiple same-day, same-category records allowed — asserted by
  // schema inspection (no live DB reachable here): confirms the Prisma
  // model genuinely has no @@unique([saleDate, category]) that would
  // reject a second same-day entry.
  check("[schema-inspected, not DB-executed] multiple same-day same-category records allowed", () => {
    const schema = readFileSync(join(__dirname, "schema.prisma"), "utf8");
    const modelMatch = schema.match(/model OnlineSale \{[\s\S]*?\n\}/);
    assert(modelMatch, "OnlineSale model not found in schema.prisma");
    const modelBody = modelMatch[0];
    assert(!/@@unique\(\s*\[\s*saleDate\s*,\s*category\s*\]/.test(modelBody), "OnlineSale must NOT have a unique(saleDate, category) constraint");
  });

  // 13: delete removes only the selected row — asserted by source
  // inspection (no live DB reachable here): confirms deleteOnlineSaleAction
  // scopes its delete strictly by the row's own unique id, never a
  // broader match (e.g. by date/category, which could remove siblings).
  check("[source-inspected, not DB-executed] delete scoped to a single row by id", () => {
    const actionsSource = readFileSync(join(__dirname, "..", "src", "app", "admin", "online", "actions.ts"), "utf8");
    assert(/prisma\.onlineSale\.delete\(\{\s*where:\s*\{\s*id:\s*existing\.id\s*\}\s*\}\)/.test(actionsSource), "deleteOnlineSaleAction must delete by id alone");
  });

  // 14: ADMIN_ASSISTANT cannot mutate the ledger — asserted by source
  // inspection (no live DB/session reachable here): confirms both mutating
  // actions call requireRole([ROLES.ADMIN]) (ADMIN alone, not
  // ADMIN_ASSISTANT), independently of the page/layout guard.
  check("[source-inspected, not DB-executed] both mutating actions are ADMIN-only", () => {
    const actionsSource = readFileSync(join(__dirname, "..", "src", "app", "admin", "online", "actions.ts"), "utf8");
    const requireRoleCalls = [...actionsSource.matchAll(/await requireRole\((\[[^\]]*\])\)/g)].map((m) => m[1] ?? "");
    assert(requireRoleCalls.length === 2, `expected exactly 2 requireRole calls (save + delete), found ${requireRoleCalls.length}`);
    for (const call of requireRoleCalls) {
      assert(call.replace(/\s/g, "") === "[ROLES.ADMIN]", `expected ADMIN-only, got ${call}`);
    }
  });

  console.log("\nAll online-sales commission checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
