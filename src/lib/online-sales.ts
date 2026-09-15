import { ONLINE_SALE_CATEGORIES } from "@/lib/constants";
import type { OnlineSaleCategory } from "@/types";

/** Canonical commission rate (basis points — 500 = 5%) and Arabic label per
 * online-sale category, for the ADMIN-only "أون لاين" ledger
 * (/admin/online). The single source both the client's live preview and
 * the server's authoritative save (see saveOnlineSalesAction in
 * src/app/admin/online/actions.ts) read from — never two competing copies
 * of the same rate. Deliberately isomorphic (no `server-only`/Prisma
 * import) so the client calculator can import it directly for its live
 * preview; a saved OnlineSale row snapshots the rate/commission it used at
 * the time (see OnlineSale's schema doc comment), so changing a rate here
 * later never rewrites an already-saved entry's meaning. */
export const ONLINE_SALE_CATEGORY_CONFIG: Record<OnlineSaleCategory, { labelAr: string; rateBps: number }> = {
  [ONLINE_SALE_CATEGORIES.WHOLESALE]: { labelAr: "الجملة", rateBps: 500 },
  [ONLINE_SALE_CATEGORIES.SUPER_WHOLESALE]: { labelAr: "جملة الجملة", rateBps: 350 },
  [ONLINE_SALE_CATEGORIES.RETAIL]: { labelAr: "المفرق", rateBps: 700 },
};

/** Display order for the three category cards/history rows — matches the
 * page's requested layout (الجملة, جملة الجملة, المفرق), independent of
 * the object key order above. */
export const ONLINE_SALE_CATEGORY_ORDER: OnlineSaleCategory[] = [
  ONLINE_SALE_CATEGORIES.WHOLESALE,
  ONLINE_SALE_CATEGORIES.SUPER_WHOLESALE,
  ONLINE_SALE_CATEGORIES.RETAIL,
];

/** Safe integer-cents commission calculation — `amountCents * rateBps` never
 * exceeds Number.MAX_SAFE_INTEGER for any realistic sale amount, and
 * dividing by the fixed 10,000 (basis-point) denominator before rounding
 * keeps the result an exact whole number of cents, avoiding the
 * floating-point display artifacts a plain `amountCents * 0.05`-style
 * float multiplication can produce. */
export function calculateCommissionCents(amountCents: number, rateBps: number): number {
  return Math.round((amountCents * rateBps) / 10_000);
}

/** "500" -> "5%", "350" -> "3.5%" — plain basis-points-to-percent division
 * already yields exactly these strings for the three fixed rates above, no
 * extra formatting/rounding logic needed. */
export function formatCommissionRateLabel(rateBps: number): string {
  return `${rateBps / 100}%`;
}

/** OnlineSale.saleDate is a native Postgres DATE (`@db.Date`) — a pure
 * calendar day with no time-of-day/timezone component, unlike
 * Order.createdAt/AccountPayment.createdAt's naive-timestamp convention
 * (see business-time.ts). Prisma represents it as a JS Date at UTC
 * midnight, so converting it back to "YYYY-MM-DD" must format it in UTC —
 * never Asia/Hebron, which would apply a timezone conversion this
 * date-only value was never subject to in the first place. */
export function saleDateToIso(saleDate: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(saleDate);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The inverse of saleDateToIso — anchors a plain "YYYY-MM-DD" string at
 * UTC midnight for storage in the `@db.Date` column, symmetric with how
 * Prisma reads it back. */
export function isoToSaleDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export interface OnlineSaleEntryToPersist {
  category: OnlineSaleCategory;
  amountCents: number;
  commissionRateBps: number;
  commissionCents: number;
}

/** Turns one day's three parsed category amounts into the exact rows to
 * persist — a category whose amount is 0 (blank/omitted on the form) is
 * silently skipped, never an error on its own. Pure and DB-free so it's
 * independently testable (see prisma/verify-online-sales-commission.ts);
 * the only caller is saveOnlineSalesAction, which is the sole place a
 * commission is ever computed for storage — the client's own live preview
 * never feeds into this. */
export function buildOnlineSaleEntries(amountsCentsByCategory: Record<OnlineSaleCategory, number>): OnlineSaleEntryToPersist[] {
  return ONLINE_SALE_CATEGORY_ORDER.filter((category) => amountsCentsByCategory[category] > 0).map((category) => {
    const { rateBps } = ONLINE_SALE_CATEGORY_CONFIG[category];
    const amountCents = amountsCentsByCategory[category];
    return { category, amountCents, commissionRateBps: rateBps, commissionCents: calculateCommissionCents(amountCents, rateBps) };
  });
}

export interface OnlineSalesCategoryTotal {
  salesCents: number;
  commissionCents: number;
}

export interface OnlineSalesTotals {
  categoryTotals: Record<OnlineSaleCategory, OnlineSalesCategoryTotal>;
  totalSalesCents: number;
  totalCommissionCents: number;
}

/** Sums a set of already-saved ledger rows into per-category and grand
 * totals — always from each row's own stored amountCents/commissionCents
 * (the rate/commission snapshotted at save time), never recomputed from
 * the current ONLINE_SALE_CATEGORY_CONFIG rates, so a later rate change
 * never silently rewrites a historical total. Pure and DB-free: the caller
 * (page.tsx) supplies whatever rows it already fetched. */
export function computeOnlineSalesTotals(rows: Pick<OnlineSaleEntryToPersist, "category" | "amountCents" | "commissionCents">[]): OnlineSalesTotals {
  const categoryTotals = Object.fromEntries(
    ONLINE_SALE_CATEGORY_ORDER.map((category) => [category, { salesCents: 0, commissionCents: 0 }]),
  ) as Record<OnlineSaleCategory, OnlineSalesCategoryTotal>;

  let totalSalesCents = 0;
  let totalCommissionCents = 0;
  for (const row of rows) {
    categoryTotals[row.category].salesCents += row.amountCents;
    categoryTotals[row.category].commissionCents += row.commissionCents;
    totalSalesCents += row.amountCents;
    totalCommissionCents += row.commissionCents;
  }

  return { categoryTotals, totalSalesCents, totalCommissionCents };
}
