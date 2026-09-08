import "server-only";
import { prisma } from "@/lib/prisma";
import { extractAnchorTokens, scoreCandidateLabel, classifyCandidates, type ConfidenceAction, type MatchType } from "@/lib/ai/fuzzy";

/** A "target" Ovi AI can resolve business facts against — either a real
 * catalog Product (a standalone item, sold by its own name/SKU) or a real
 * PhoneModel (a device compatibility target — most "جفرات A26"-style
 * questions actually mean this: every accessory product compatible with
 * that model, not one product's own literal name). Every id here is always
 * a real, persisted DB id — the model can select one of these, but can never
 * invent one (see searchCatalogCandidates' own doc comment). */
export type CatalogTargetType = "PRODUCT" | "PHONE_MODEL";

export interface CatalogCandidate {
  targetType: CatalogTargetType;
  targetId: string;
  label: string;
  subLabel: string | null;
  score: number;
  matchType: MatchType;
}

export interface CatalogSearchResult {
  candidates: CatalogCandidate[];
  /** Deterministic, server-computed instruction (see src/lib/ai/fuzzy.ts's
   * CONFIDENCE_BANDS) — the model must follow this, never decide on its own
   * whether a match is "good enough". AUTO_RESOLVE only when the top
   * candidate is both strongly scored AND clearly ahead of the runner-up. */
  recommendedAction: ConfidenceAction;
}

const CANDIDATE_LIMIT_DEFAULT = 8;
const CANDIDATE_LIMIT_MAX = 12;
/** Bounded DB pool size per query, per model (PhoneModel/Product) — the
 * "cast a slightly wider net via cheap anchor tokens, then rank precisely
 * in application code" strategy. Never the whole catalog: a typical Ovi
 * catalog has far fewer than this many rows sharing one anchor token (e.g.
 * "26"), and even in the worst case this stays a small, fixed-cost read. */
const POOL_FETCH_LIMIT = 60;

/** Stage 1 of the required two-stage resolution pattern (search real DB
 * candidates, then let the model select/ask). Two steps, never one giant
 * unbounded scan:
 *   1. extractAnchorTokens picks a handful of selective anchor tokens
 *      (model-code-like digit tokens preferred; brand/category words as
 *      fallback) and fetches a BOUNDED pool (POOL_FETCH_LIMIT per model)
 *      of PhoneModel/Product rows whose name/nameAr/brand/sku CONTAINS any
 *      anchor — a cheap, wide net, not a precise filter.
 *   2. scoreCandidateLabel (src/lib/ai/fuzzy.ts) then fuzzy-ranks that pool
 *      against the FULL original query (typos, synonyms, spacing and all),
 *      entirely in application code — never sent to the model.
 * NEVER fabricates a candidate — every returned targetId is a real row this
 * exact query just read. recommendedAction (see CatalogSearchResult) tells
 * the caller deterministically whether to auto-continue, ask the user, or
 * report no match — never left to the model's own judgment. */
export async function searchCatalogCandidates(query: string, limit = CANDIDATE_LIMIT_DEFAULT): Promise<CatalogSearchResult> {
  const boundedLimit = Math.max(1, Math.min(limit, CANDIDATE_LIMIT_MAX));
  const anchors = extractAnchorTokens(query);
  if (anchors.length === 0) return { candidates: [], recommendedAction: "NO_MATCH" };

  const anchorFilters = anchors.map((anchor) => ({ contains: anchor, mode: "insensitive" as const }));
  const skuCandidates = anchors.map((anchor) => anchor.toUpperCase());

  const [phoneModels, products] = await Promise.all([
    prisma.phoneModel.findMany({
      where: {
        isActive: true,
        OR: [
          ...anchorFilters.map((filter) => ({ name: filter })),
          ...anchorFilters.map((filter) => ({ nameAr: filter })),
          ...anchorFilters.map((filter) => ({ phoneBrand: { name: filter } })),
          ...anchorFilters.map((filter) => ({ phoneBrand: { nameAr: filter } })),
        ],
      },
      select: { id: true, name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } },
      take: POOL_FETCH_LIMIT,
    }),
    prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { sku: { in: skuCandidates } },
          ...anchorFilters.map((filter) => ({ name: filter })),
          ...anchorFilters.map((filter) => ({ nameAr: filter })),
          ...anchorFilters.map((filter) => ({ category: { name: filter } })),
          ...anchorFilters.map((filter) => ({ category: { nameAr: filter } })),
        ],
      },
      select: { id: true, sku: true, name: true, nameAr: true, category: { select: { name: true, nameAr: true } }, brand: { select: { name: true } } },
      take: POOL_FETCH_LIMIT,
    }),
  ]);

  const candidates: CatalogCandidate[] = [];

  for (const model of phoneModels) {
    const modelLabel = model.nameAr ?? model.name;
    const brandLabel = model.phoneBrand.nameAr ?? model.phoneBrand.name;
    const fullLabel = `${brandLabel} ${modelLabel}`;
    // Score against both the full "brand + model" label and the bare model
    // label — a query naming only the model ("A26") shouldn't be diluted by
    // an unmatched brand token when computing the token average.
    const fullScore = scoreCandidateLabel(query, fullLabel);
    const modelOnlyScore = scoreCandidateLabel(query, modelLabel);
    const best = fullScore.score >= modelOnlyScore.score ? fullScore : modelOnlyScore;
    if (best.score > 0) {
      candidates.push({ targetType: "PHONE_MODEL", targetId: model.id, label: fullLabel, subLabel: "موديل جهاز", score: best.score, matchType: best.matchType });
    }
  }

  for (const product of products) {
    const label = product.nameAr ?? product.name;
    const skuMatch = anchors.some((anchor) => anchor.toUpperCase() === product.sku.toUpperCase());
    const labelScore = scoreCandidateLabel(query, label);
    const score = skuMatch ? 100 : labelScore.score;
    const matchType: MatchType = skuMatch ? "EXACT" : labelScore.matchType;
    if (score > 0) {
      const subLabelParts = [product.brand?.name, product.category?.nameAr ?? product.category?.name].filter(Boolean);
      candidates.push({ targetType: "PRODUCT", targetId: product.id, label, subLabel: subLabelParts.length > 0 ? subLabelParts.join(" — ") : null, score, matchType });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ar"));

  // Dedupe by (targetType, targetId) — keeps the highest-scored occurrence.
  const seen = new Set<string>();
  const deduped: CatalogCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.targetType}:${candidate.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  const limited = deduped.slice(0, boundedLimit);
  return { candidates: limited, recommendedAction: classifyCandidates(limited) };
}

export interface ProductDetails {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  categoryLabel: string | null;
  brandLabel: string | null;
  isActive: boolean;
  variantMode: string;
  inventoryTrackingMode: string;
  wholesalePriceCents: number;
  retailPriceCents: number;
  /** Real compatible device labels, when this product tracks compatibility
   * (PHONE_COMPATIBILITY or DEVICE_MODEL_COLOR) — empty for a plain product. */
  compatibleModels: string[];
}

/** Real product details only — never a guessed price or spec. Returns null
 * when the id doesn't resolve to a real, existing Product (defensive only;
 * every real caller already resolved this id via searchCatalogCandidates). */
export async function getProductDetails(productId: string): Promise<ProductDetails | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      name: true,
      nameAr: true,
      isActive: true,
      variantMode: true,
      inventoryTrackingMode: true,
      wholesalePriceCents: true,
      retailPriceCents: true,
      category: { select: { name: true, nameAr: true } },
      brand: { select: { name: true } },
      variants: {
        where: { isActive: true },
        select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } },
        take: 20,
      },
      deviceColorVariants: {
        where: { isActive: true },
        select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } },
        take: 20,
      },
    },
  });
  if (!product) return null;

  const modelLabels = new Set<string>();
  for (const variant of product.variants) {
    modelLabels.add(`${variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name} ${variant.phoneModel.nameAr ?? variant.phoneModel.name}`);
  }
  for (const combo of product.deviceColorVariants) {
    modelLabels.add(`${combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name} ${combo.phoneModel.nameAr ?? combo.phoneModel.name}`);
  }

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
    brandLabel: product.brand?.name ?? null,
    isActive: product.isActive,
    variantMode: product.variantMode,
    inventoryTrackingMode: product.inventoryTrackingMode,
    wholesalePriceCents: product.wholesalePriceCents,
    retailPriceCents: product.retailPriceCents,
    compatibleModels: [...modelLabels],
  };
}
