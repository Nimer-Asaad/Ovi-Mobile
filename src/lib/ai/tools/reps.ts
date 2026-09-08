import "server-only";
import { prisma } from "@/lib/prisma";
import { isLowStock } from "@/lib/inventory";
import { getBusinessDateIso } from "@/lib/reporting";
import { buildSearchVariants } from "@/lib/ai/normalization";
import { scoreCandidateLabel, classifyCandidates, type ConfidenceAction, type MatchType } from "@/lib/ai/fuzzy";
import { resolvePeriod, type SalesPeriodInput } from "@/lib/ai/tools/sales";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";

export interface RepCandidate {
  repId: string;
  label: string;
  employeeCode: string;
  score: number;
  matchType: MatchType;
}

export interface RepSearchResult {
  candidates: RepCandidate[];
  recommendedAction: ConfidenceAction;
}

const REP_LIMIT_DEFAULT = 6;
const POOL_FETCH_LIMIT = 30;

/** Resolves "أحمد" -> a real SalesRepresentative row by the linked User's
 * own name or the rep's employeeCode — the same Stage-1 candidate pattern
 * as searchCatalogCandidates/searchMerchants, fuzzy-ranked
 * (src/lib/ai/fuzzy.ts). Not one of the 13 originally enumerated tools, but
 * required by the "never invent an entity" rule: a rep referenced only by
 * first name has no other safe resolution path. See the feature report for
 * this addition. */
export async function searchReps(query: string, limit = REP_LIMIT_DEFAULT): Promise<RepSearchResult> {
  const variants = buildSearchVariants(query);
  if (variants.length === 0) return { candidates: [], recommendedAction: "NO_MATCH" };

  const reps = await prisma.salesRepresentative.findMany({
    where: {
      isActive: true,
      OR: variants.flatMap((variant) => [
        { user: { name: { contains: variant, mode: "insensitive" as const } } },
        { employeeCode: { contains: variant, mode: "insensitive" as const } },
      ]),
    },
    select: { id: true, employeeCode: true, user: { select: { name: true } } },
    take: POOL_FETCH_LIMIT,
  });

  const candidates = reps.map((rep): RepCandidate => {
    const labelScore = scoreCandidateLabel(query, rep.user.name);
    const score = Math.max(labelScore.score, 35);
    return { repId: rep.id, label: rep.user.name, employeeCode: rep.employeeCode, score, matchType: labelScore.score > 0 ? labelScore.matchType : "WEAK" };
  });

  candidates.sort((a, b) => b.score - a.score);
  const limited = candidates.slice(0, limit);
  return { candidates: limited, recommendedAction: classifyCandidates(limited) };
}

export interface RepSummary {
  repId: string;
  repName: string;
  employeeCode: string;
  isActive: boolean;
  stock: { totalUnits: number; distinctProducts: number; lowStockCount: number };
  sales: { period: string; count: number; totalCents: number };
  paymentsCollected: { period: string; count: number; totalCents: number };
}

/** "أحمد شو معه؟" / "كم باع أحمد اليوم؟" — one bounded snapshot combining
 * this rep's own car stock (reusing the exact same InventoryItem-based
 * counting getRepStockStats already uses on /rep/stock — no second
 * calculation) and their sales/collected-payments for a period (default
 * TODAY when the caller doesn't specify one, matching "كم باع أحمد اليوم؟"
 * as the most common phrasing). Sales/payments here are queried directly
 * (not through fetchSaleActivityRows) since both are already scoped to one
 * rep's own ids and only need a count + a sum — the same terminal-order/
 * cancelled-payment exclusion rules apply. */
export async function getRepSummary(repId: string, period: SalesPeriodInput = { type: "TODAY" }): Promise<RepSummary | null> {
  const rep = await prisma.salesRepresentative.findUnique({
    where: { id: repId },
    select: {
      id: true,
      employeeCode: true,
      isActive: true,
      userId: true,
      user: { select: { name: true } },
      carStockLocation: { select: { id: true } },
    },
  });
  if (!rep) return null;

  const resolved = resolvePeriod(period);
  const locationId = rep.carStockLocation?.id ?? null;

  const [stockItems, orders, payments] = await Promise.all([
    locationId
      ? prisma.inventoryItem.findMany({ where: { locationId, quantity: { gt: 0 } }, select: { productId: true, quantity: true } })
      : Promise.resolve([]),
    prisma.$queryRaw<{ status: string; totalCents: number }[]>`
      SELECT "status", "totalCents" FROM "orders"
      WHERE "createdByRepId" = ${rep.id}
        AND (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${resolved.fromIso}::date AND ${resolved.toIso}::date
    `,
    prisma.$queryRaw<{ amountCents: number; cancelled: boolean }[]>`
      SELECT ap."amountCents", (apc."id" IS NOT NULL) AS cancelled
      FROM "account_payments" ap
      LEFT JOIN "account_payment_cancellations" apc ON apc."paymentId" = ap."id"
      WHERE ap."createdById" = ${rep.userId}
        AND ((ap."createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date BETWEEN ${resolved.fromIso}::date AND ${resolved.toIso}::date
    `,
  ]);

  let totalUnits = 0;
  let lowStockCount = 0;
  const distinctProductIds = new Set<string>();
  for (const item of stockItems) {
    totalUnits += item.quantity;
    if (isLowStock(item.quantity)) lowStockCount += 1;
    distinctProductIds.add(item.productId);
  }

  const activeOrders = orders.filter((order) => !isTerminalOrderStatus(order.status));
  const activePayments = payments.filter((payment) => !payment.cancelled);

  return {
    repId: rep.id,
    repName: rep.user.name,
    employeeCode: rep.employeeCode,
    isActive: rep.isActive,
    stock: { totalUnits, distinctProducts: distinctProductIds.size, lowStockCount },
    sales: { period: resolved.label, count: activeOrders.length, totalCents: activeOrders.reduce((sum, order) => sum + order.totalCents, 0) },
    paymentsCollected: { period: resolved.label, count: activePayments.length, totalCents: activePayments.reduce((sum, payment) => sum + payment.amountCents, 0) },
  };
}

// getBusinessDateIso re-exported purely so the orchestrator can label
// "today" consistently without importing reporting.ts directly for that one
// value — avoids a second Palestine-time source of truth in the AI layer.
export { getBusinessDateIso };
