import "server-only";
import { prisma } from "@/lib/prisma";
import { ORDER_STATUSES } from "@/lib/constants";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { getBusinessDateIso, fetchSaleActivityRows, fetchPaymentActivityRows, computeActivityTotals } from "@/lib/reporting";
import { classifyProductScope, type ProductScope } from "@/lib/ai/local/product-scope";
import type { CatalogTargetType } from "@/lib/ai/tools/catalog";

/** Derived FROM the canonical isTerminalOrderStatus (order-lifecycle-rules.ts)
 * over the canonical ORDER_STATUSES list — never a second, hand-maintained
 * status list. If the canonical definition of "terminal" ever changes, this
 * array changes with it automatically; nothing here can silently drift out
 * of sync with the rest of the app's reports. Only needed because Prisma's
 * `notIn` filter requires a concrete array, not a predicate function — every
 * OTHER terminal check in this file calls isTerminalOrderStatus directly. */
const TERMINAL_ORDER_STATUSES = Object.values(ORDER_STATUSES).filter(isTerminalOrderStatus);

export type SalesPeriodInput =
  | { type: "TODAY" | "YESTERDAY" | "THIS_WEEK" | "THIS_MONTH" }
  | { type: "CUSTOM"; fromIso: string; toIso: string };

export interface ResolvedPeriod {
  fromIso: string;
  toIso: string;
  label: string;
}

function isoAddDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Resolves a natural period request into a concrete [fromIso, toIso]
 * Palestine-calendar-date range, anchored on getBusinessDateIso (the same
 * Asia/Hebron "today" src/lib/reporting.ts's own report range uses — never
 * a second, competing timezone calculation). "THIS_WEEK" is the trailing 7
 * Palestine calendar days including today (matches how a shop owner
 * actually thinks of "this week" day-to-day, not an ISO Monday-start week);
 * "THIS_MONTH" is day 1 of the current Palestine calendar month through
 * today. */
export function resolvePeriod(period: SalesPeriodInput, now: Date = new Date()): ResolvedPeriod {
  const todayIso = getBusinessDateIso(now);
  switch (period.type) {
    case "TODAY":
      return { fromIso: todayIso, toIso: todayIso, label: "اليوم" };
    case "YESTERDAY": {
      const yesterday = isoAddDays(todayIso, -1);
      return { fromIso: yesterday, toIso: yesterday, label: "أمس" };
    }
    case "THIS_WEEK":
      return { fromIso: isoAddDays(todayIso, -6), toIso: todayIso, label: "هذا الأسبوع" };
    case "THIS_MONTH": {
      const [year, month] = todayIso.split("-");
      return { fromIso: `${year}-${month}-01`, toIso: todayIso, label: "هذا الشهر" };
    }
    case "CUSTOM":
      return { fromIso: period.fromIso, toIso: period.toIso, label: "فترة مخصصة" };
  }
}

/** Order ids whose createdAt resolves to a Palestine business date inside
 * [fromIso, toIso] — the SAME `"createdAt" AT TIME ZONE current_setting
 * ('TIMEZONE')` -> `AT TIME ZONE 'Asia/Hebron'` technique
 * src/lib/reporting.ts's own (private) getOrderIdsInRange already uses and
 * documents in full; reimplemented here (not exported from reporting.ts)
 * rather than duplicating a different date-bucketing rule. Never a
 * hardcoded offset, never `SET TIME ZONE`. */
async function getOrderIdsInPeriod(fromIso: string, toIso: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "orders"
    WHERE (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${fromIso}::date AND ${toIso}::date
  `;
  return rows.map((row) => row.id);
}

export interface SalesSummary {
  period: ResolvedPeriod;
  activeSalesCount: number;
  salesTotalCents: number;
  paymentsCount: number;
  paymentsTotalCents: number;
}

/** Company-wide sales/payments KPIs for a period — reuses
 * fetchSaleActivityRows + computeActivityTotals (src/lib/reporting.ts,
 * already the canonical report-page logic: terminal/cancelled-sale and
 * cancelled-payment exclusion, Palestine business time) rather than a
 * second, ad-hoc SUM. Only the four aggregate numbers are ever returned —
 * the underlying row arrays never reach the model. */
export async function getSalesSummary(period: SalesPeriodInput): Promise<SalesSummary> {
  const resolved = resolvePeriod(period);
  const [sales, payments] = await Promise.all([
    fetchSaleActivityRows({ fromIso: resolved.fromIso, toIso: resolved.toIso }, (orderNumber) => `/admin/orders/${orderNumber}`),
    // fetchPaymentActivityRows needs three href builders the AI tool has no
    // use for (no clickable UI here) — inert ones, still the exact same
    // canonical function reporting.ts exports.
    fetchPaymentActivityRows(
      { fromIso: resolved.fromIso, toIso: resolved.toIso },
      () => "#",
      () => "#",
      () => "#",
    ),
  ]);
  const totals = computeActivityTotals(sales, payments);
  return {
    period: resolved,
    activeSalesCount: totals.salesCount,
    salesTotalCents: totals.salesTotalCents,
    paymentsCount: totals.paymentsCount,
    paymentsTotalCents: totals.paymentsTotalCents,
  };
}

export interface ProductSalesResult {
  label: string;
  period: ResolvedPeriod;
  quantitySold: number;
  amountCents: number;
  orderCount: number;
}

/** "كم بعنا A26 هالشهر؟" — quantity/amount/order-count sold for an already-
 * resolved target within a period. Scoped by real OrderItem rows
 * (productId for a PRODUCT target; the target PhoneModel's own variant/
 * combo ids for a PHONE_MODEL target — same resolution as
 * getInventorySummary, never a second guess at which rows belong to this
 * target) and excludes CANCELLED/RETURNED orders (isTerminalOrderStatus's
 * own two statuses — the canonical terminal-order rule, never a private
 * reinterpretation).
 *
 * `productScope`, for a PHONE_MODEL target, narrows WHICH compatible
 * products' variant/combo ids get included (see buildPhoneModelItemWhere)
 * — a broad "كم بعنا iPhone 17 Pro Max؟" sums every compatible item's
 * sales, while "كم بعنا جفرات iPhone 17 Pro Max؟" sums only the CASE_COVER
 * ones — never a second, competing sales formula, just a scoped input id
 * set fed into the exact same OrderItem aggregation below. Ignored for a
 * PRODUCT target (already one specific, already-resolved item). */
export async function getProductSales(targetType: CatalogTargetType, targetId: string, period: SalesPeriodInput, productScope?: ProductScope | null): Promise<ProductSalesResult | null> {
  const resolved = resolvePeriod(period);
  const orderIds = await getOrderIdsInPeriod(resolved.fromIso, resolved.toIso);
  if (orderIds.length === 0) {
    const label = await resolveTargetLabel(targetType, targetId);
    if (!label) return null;
    return { label, period: resolved, quantitySold: 0, amountCents: 0, orderCount: 0 };
  }

  const itemWhere =
    targetType === "PRODUCT"
      ? { productId: targetId }
      : await buildPhoneModelItemWhere(targetId, productScope);
  if (!itemWhere) return null;

  const items = await prisma.orderItem.findMany({
    where: {
      orderId: { in: orderIds },
      order: { status: { notIn: TERMINAL_ORDER_STATUSES } },
      ...itemWhere,
    },
    select: { quantity: true, totalCents: true, orderId: true },
  });

  const label = await resolveTargetLabel(targetType, targetId);
  if (!label) return null;

  const quantitySold = items.reduce((sum, item) => sum + item.quantity, 0);
  const amountCents = items.reduce((sum, item) => sum + item.totalCents, 0);
  const orderCount = new Set(items.map((item) => item.orderId)).size;

  return { label, period: resolved, quantitySold, amountCents, orderCount };
}

async function resolveTargetLabel(targetType: CatalogTargetType, targetId: string): Promise<string | null> {
  if (targetType === "PRODUCT") {
    const product = await prisma.product.findUnique({ where: { id: targetId }, select: { name: true, nameAr: true } });
    return product ? (product.nameAr ?? product.name) : null;
  }
  const model = await prisma.phoneModel.findUnique({
    where: { id: targetId },
    select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } },
  });
  return model ? `${model.phoneBrand.nameAr ?? model.phoneBrand.name} ${model.nameAr ?? model.name}` : null;
}

/** Builds the OrderItem WHERE clause for every real variant/combo id
 * compatible with a phone model — optionally narrowed to only the ids
 * belonging to products matching `productScope` (classifyProductScope,
 * name/category keyword-driven — see product-scope.ts), by pulling each
 * variant/combo's own linked Product for classification before filtering.
 * Never a hardcoded product id list, never a second sales formula — this
 * only changes WHICH real ids feed the SAME OrderItem aggregation in
 * getProductSales. */
async function buildPhoneModelItemWhere(phoneModelId: string, productScope?: ProductScope | null): Promise<{ OR: object[] } | null> {
  const productSelect = { select: { name: true, nameAr: true, category: { select: { name: true, nameAr: true } } } } as const;
  const [variants, combos] = await Promise.all([
    prisma.productVariant.findMany({ where: { phoneModelId }, select: { id: true, product: productSelect } }),
    prisma.deviceColorVariant.findMany({ where: { phoneModelId }, select: { id: true, product: productSelect } }),
  ]);

  const matchesScope = (product: { name: string; nameAr: string | null; category: { name: string; nameAr: string | null } | null }) =>
    !productScope || classifyProductScope({ name: product.name, nameAr: product.nameAr, categoryName: product.category?.name, categoryNameAr: product.category?.nameAr }) === productScope;

  const scopedVariants = variants.filter((variant) => matchesScope(variant.product));
  const scopedCombos = combos.filter((combo) => matchesScope(combo.product));

  if (scopedVariants.length === 0 && scopedCombos.length === 0) return null;
  return {
    OR: [
      ...(scopedVariants.length > 0 ? [{ variantId: { in: scopedVariants.map((variant) => variant.id) } }] : []),
      ...(scopedCombos.length > 0 ? [{ deviceColorVariantId: { in: scopedCombos.map((combo) => combo.id) } }] : []),
    ],
  };
}

export interface TopSellingProductRow {
  productId: string;
  label: string;
  quantitySold: number;
  amountCents: number;
}

const TOP_PRODUCTS_LIMIT_DEFAULT = 10;
const TOP_PRODUCTS_LIMIT_MAX = 15;

/** "شو أكثر شي انباع هالشهر؟" — bounded, sorted (by quantity) list of
 * top-selling products in a period. Same terminal-order exclusion as
 * getProductSales. Aggregates in Node over one bounded OrderItem fetch —
 * acceptable for the short periods this tool supports (today/week/month);
 * never returns the underlying per-order rows to the model, only the
 * final ranked summary. */
export async function getTopSellingProducts(period: SalesPeriodInput, limit = TOP_PRODUCTS_LIMIT_DEFAULT): Promise<{ period: ResolvedPeriod; rows: TopSellingProductRow[] }> {
  const resolved = resolvePeriod(period);
  const boundedLimit = Math.max(1, Math.min(limit, TOP_PRODUCTS_LIMIT_MAX));
  const orderIds = await getOrderIdsInPeriod(resolved.fromIso, resolved.toIso);
  if (orderIds.length === 0) return { period: resolved, rows: [] };

  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds }, order: { status: { notIn: TERMINAL_ORDER_STATUSES } } },
    select: {
      productId: true,
      quantity: true,
      totalCents: true,
      productNameSnapshot: true,
      product: { select: { name: true, nameAr: true } },
    },
  });

  const byProduct = new Map<string, { label: string; quantitySold: number; amountCents: number }>();
  for (const item of items) {
    const label = item.product.nameAr ?? item.product.name ?? item.productNameSnapshot ?? "منتج";
    const entry = byProduct.get(item.productId) ?? { label, quantitySold: 0, amountCents: 0 };
    entry.quantitySold += item.quantity;
    entry.amountCents += item.totalCents;
    byProduct.set(item.productId, entry);
  }

  const rows = [...byProduct.entries()]
    .map(([productId, entry]) => ({ productId, ...entry }))
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, boundedLimit);

  return { period: resolved, rows };
}
