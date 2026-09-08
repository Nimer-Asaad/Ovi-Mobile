import "server-only";
import { prisma } from "@/lib/prisma";
import { getAccountBalanceCents } from "@/lib/accounts";
import { buildSearchVariants } from "@/lib/ai/normalization";
import { scoreCandidateLabel, classifyCandidates, type ConfidenceAction, type MatchType } from "@/lib/ai/fuzzy";

export interface MerchantCandidate {
  merchantId: string;
  label: string;
  subLabel: string | null;
  score: number;
  matchType: MatchType;
}

export interface MerchantSearchResult {
  candidates: MerchantCandidate[];
  /** See src/lib/ai/fuzzy.ts CONFIDENCE_BANDS — same deterministic
   * auto-resolve/ask/no-match rule as the catalog search. */
  recommendedAction: ConfidenceAction;
}

const MERCHANT_LIMIT_DEFAULT = 8;
const MERCHANT_LIMIT_MAX = 12;
const POOL_FETCH_LIMIT = 40;

/** "كم على تاجر فلان؟" — Stage 1 candidate search over real Merchant rows
 * only (business name, contact name, phone, whatsapp, or the linked User's
 * own name/phone for a login-based merchant) — the same field set
 * /admin/merchants' own search already uses, fetched as a bounded pool then
 * fuzzy-ranked (src/lib/ai/fuzzy.ts) so a typo in a trader's name still
 * resolves. Never fabricates a merchant. A phone/contactName-only DB match
 * (the searched field differs from the display label) still gets a
 * DB_MATCH floor score even if the fuzzy label score is 0, so a phone-number
 * query still surfaces its match — but that floor is deliberately below the
 * ASK threshold banding relies on for a name-based fuzzy score. */
export async function searchMerchants(query: string, limit = MERCHANT_LIMIT_DEFAULT): Promise<MerchantSearchResult> {
  const boundedLimit = Math.max(1, Math.min(limit, MERCHANT_LIMIT_MAX));
  const variants = buildSearchVariants(query);
  if (variants.length === 0) return { candidates: [], recommendedAction: "NO_MATCH" };

  const orFilters = variants.flatMap((variant) => [
    { businessName: { contains: variant, mode: "insensitive" as const } },
    { contactName: { contains: variant, mode: "insensitive" as const } },
    { contactPhone: { contains: variant, mode: "insensitive" as const } },
    { whatsappPhone: { contains: variant, mode: "insensitive" as const } },
    { user: { name: { contains: variant, mode: "insensitive" as const } } },
    { user: { phone: { contains: variant, mode: "insensitive" as const } } },
  ]);

  const merchants = await prisma.merchant.findMany({
    where: { OR: orFilters },
    select: { id: true, businessName: true, contactName: true, region: true, status: true, user: { select: { name: true } } },
    take: POOL_FETCH_LIMIT,
  });

  const candidates = merchants.map((merchant): MerchantCandidate => {
    const label = merchant.user?.name ?? merchant.businessName;
    const labelScore = scoreCandidateLabel(query, label);
    // The DB WHERE already matched something for this row (name, phone, or
    // contactName) even when the fuzzy score against the DISPLAY label is
    // low (e.g. matched on phone number) — a small floor keeps it visible
    // as a real, deliberate DB match rather than disappearing entirely.
    const score = Math.max(labelScore.score, 35);
    return { merchantId: merchant.id, label, subLabel: merchant.region, score, matchType: labelScore.score > 0 ? labelScore.matchType : "WEAK" };
  });

  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ar"));
  const limited = candidates.slice(0, boundedLimit);
  return { candidates: limited, recommendedAction: classifyCandidates(limited) };
}

export interface MerchantAccountSummary {
  merchantId: string;
  label: string;
  status: string;
  assignedRepName: string | null;
  balanceCents: number;
  openingBalanceCents: number;
  lastSaleAt: Date | null;
  lastPaymentAt: Date | null;
}

/** "كم على فلان؟" — real current debt via getAccountBalanceCents (the ONE
 * canonical balance formula, src/lib/accounts.ts) — never a second,
 * ad-hoc SUM. Returns null when the merchant has no ledger account yet
 * (genuinely zero business history, not the same as "debt is zero"). */
export async function getMerchantAccountSummary(merchantId: string): Promise<MerchantAccountSummary | null> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      businessName: true,
      status: true,
      user: { select: { name: true } },
      assignedRep: { select: { user: { select: { name: true } } } },
      account: {
        select: {
          openingBalanceCents: true,
          orders: { select: { status: true, totalCents: true, createdAt: true } },
          payments: { select: { amountCents: true, createdAt: true, cancellation: { select: { id: true } } } },
        },
      },
    },
  });
  if (!merchant) return null;

  const label = merchant.user?.name ?? merchant.businessName;
  if (!merchant.account) {
    return {
      merchantId: merchant.id,
      label,
      status: merchant.status,
      assignedRepName: merchant.assignedRep?.user.name ?? null,
      balanceCents: 0,
      openingBalanceCents: 0,
      lastSaleAt: null,
      lastPaymentAt: null,
    };
  }

  const balanceCents = getAccountBalanceCents(merchant.account);
  const lastSaleAt = merchant.account.orders.reduce<Date | null>((latest, order) => (!latest || order.createdAt > latest ? order.createdAt : latest), null);
  const lastPaymentAt = merchant.account.payments.reduce<Date | null>((latest, payment) => (!latest || payment.createdAt > latest ? payment.createdAt : latest), null);

  return {
    merchantId: merchant.id,
    label,
    status: merchant.status,
    assignedRepName: merchant.assignedRep?.user.name ?? null,
    balanceCents,
    openingBalanceCents: merchant.account.openingBalanceCents,
    lastSaleAt,
    lastPaymentAt,
  };
}

export interface MerchantActivityRow {
  type: "SALE" | "PAYMENT";
  reference: string;
  amountCents: number;
  status: string | null;
  createdAt: Date;
}

const ACTIVITY_LIMIT_DEFAULT = 10;
const ACTIVITY_LIMIT_MAX = 20;

/** Recent sales + payments for a merchant, bounded and interleaved
 * newest-first — a lighter-weight sibling of getMerchantAccountSummary for
 * "آخر دفعة لفلان متى؟" / "آخر الحركات". Never returns the merchant's full
 * history — always capped. */
export async function getMerchantRecentActivity(merchantId: string, limit = ACTIVITY_LIMIT_DEFAULT): Promise<MerchantActivityRow[]> {
  const boundedLimit = Math.max(1, Math.min(limit, ACTIVITY_LIMIT_MAX));

  const account = await prisma.customerAccount.findUnique({
    where: { merchantId },
    select: {
      orders: { orderBy: { createdAt: "desc" }, take: boundedLimit, select: { orderNumber: true, totalCents: true, status: true, createdAt: true } },
      payments: { orderBy: { createdAt: "desc" }, take: boundedLimit, select: { id: true, amountCents: true, createdAt: true, cancellation: { select: { id: true } } } },
    },
  });
  if (!account) return [];

  const rows: MerchantActivityRow[] = [
    ...account.orders.map((order): MerchantActivityRow => ({ type: "SALE", reference: order.orderNumber, amountCents: order.totalCents, status: order.status, createdAt: order.createdAt })),
    ...account.payments.map((payment): MerchantActivityRow => ({ type: "PAYMENT", reference: payment.id, amountCents: payment.amountCents, status: payment.cancellation ? "CANCELLED" : null, createdAt: payment.createdAt })),
  ];

  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, boundedLimit);
}
