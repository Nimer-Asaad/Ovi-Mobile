/** The local, zero-LLM Ovi AI turn engine — the direct replacement for the
 * old provider-driven orchestrator. Deterministic pipeline, no network call
 * anywhere in this file or anything it imports:
 *
 *   message + context -> parseLocalQuery (router.ts)
 *                      -> resolveEntity (entity-resolution.ts), when needed
 *                      -> exactly one safe, read-only Ovi capability/tool
 *                      -> response-builder.ts -> StructuredResponse
 *
 * The engine itself chooses which tool to call from the router's own
 * LocalIntent — never a client-supplied tool name (see actions.ts: the
 * client can only ever send message/context/learnedHint, never "run this
 * tool"). */

import "server-only";
import { parseLocalQuery, buildGeneralHelpSuggestions } from "@/lib/ai/local/router";
import { resolveEntity } from "@/lib/ai/local/entity-resolution";
import { buildFollowUpSuggestions } from "@/lib/ai/local/suggestions";
import {
  buildInventoryResponse,
  buildLowStockResponse,
  buildStockLocationsResponse,
  buildRepInventoryResponse,
  buildProductSalesResponse,
  buildSalesSummaryResponse,
  buildTopSellingResponse,
  buildMerchantAccountResponse,
  buildMerchantActivityResponse,
  buildRepSummaryResponse,
  buildProductPriceResponse,
  buildGlobalCaseCountResponse,
  buildGlobalCaseInventoryResponse,
  buildRepPaymentsSummaryResponse,
  buildRepSalesSummaryResponse,
  buildMerchantAccountsOverviewResponse,
  buildReadOnlyResponse,
  buildConversationalResponse,
  buildGeneralHelpResponse,
  buildClarificationResponse,
  buildNoMatchResponse,
  buildErrorResponse,
} from "@/lib/ai/local/response-builder";
import { getInventorySummary, getRepInventoryBreakdown, getLowStockItems, getStockLocationsForItem, getGlobalCaseInventorySummary } from "@/lib/ai/tools/inventory";
import { getSalesSummary, getProductSales, getTopSellingProducts } from "@/lib/ai/tools/sales";
import { getMerchantAccountSummary, getMerchantRecentActivity, getMerchantAccountsOverview } from "@/lib/ai/tools/merchants";
import { getRepSummary, getRepPaymentsSummary, getRepSalesSummary } from "@/lib/ai/tools/reps";
import { getProductDetails } from "@/lib/ai/tools/catalog";
import type { OviAiContext, OviAiTurnResult, StructuredResponse } from "@/lib/ai/types";
import type { EntityResolutionResult, LearnedHintInput } from "@/lib/ai/local/types";

/** The coarse, advisory context label intent.ts's own LAST_INTENT_CATEGORIES
 * map already understands (see src/lib/ai/intent.ts) — deliberately coarser
 * than LocalIntent so a contextless follow-up's category fallback keeps
 * working unchanged. Never used for authorization/branching, only to pick a
 * sensible default category for the NEXT message when it names no keyword
 * of its own. */
const CTX = { INVENTORY: "INVENTORY", SALES: "SALES", MERCHANT: "MERCHANT", REP: "REP", PRODUCT_DETAILS: "PRODUCT_DETAILS" } as const;

function entityContextPatch(resolution: EntityResolutionResult): Partial<OviAiContext> {
  if (resolution.status !== "RESOLVED" || !resolution.type || !resolution.id) return {};
  switch (resolution.type) {
    case "PRODUCT":
      return { resolvedProductId: resolution.id, resolvedProductLabel: resolution.label ?? null, resolvedPhoneModelId: null, resolvedPhoneModelLabel: null };
    case "PHONE_MODEL":
      return { resolvedPhoneModelId: resolution.id, resolvedPhoneModelLabel: resolution.label ?? null, resolvedProductId: null, resolvedProductLabel: null };
    case "MERCHANT":
      return { resolvedMerchantId: resolution.id, resolvedMerchantLabel: resolution.label ?? null };
    case "REP":
      return { resolvedRepId: resolution.id, resolvedRepLabel: resolution.label ?? null };
  }
}

interface TurnOutcome {
  response: StructuredResponse;
  contextPatch: Partial<OviAiContext>;
  candidates?: import("@/lib/ai/types").OviAiChip[];
}

export interface LocalTurnInput {
  message: string;
  context: OviAiContext;
  learnedHint: LearnedHintInput | null;
}

/** Runs one full Ovi AI local turn. Never throws to the caller — resolves to
 * a safe OviAiTurnResult on any failure (a DB error surfaces as the same
 * generic friendly message a provider failure used to). */
export async function runLocalOviTurn(input: LocalTurnInput): Promise<OviAiTurnResult> {
  const context = input.context ?? {};

  try {
    const plan = parseLocalQuery(input.message, context);

    if (plan.intent === "READ_ONLY_REFUSAL") {
      return {
        response: buildReadOnlyResponse(),
        context,
        suggestions: [
          { label: "افحص المتوفر", message: "شو قرب يخلص بالمخزون؟" },
          { label: "مبيعات اليوم", message: "مبيعات اليوم" },
        ],
      };
    }

    if (plan.intent === "CONVERSATIONAL") {
      return { response: buildConversationalResponse(), context, suggestions: buildFollowUpSuggestions(context) };
    }

    if (plan.intent === "GENERAL_HELP") {
      const { summary, suggestions } = buildGeneralHelpSuggestions(input.message, plan.entityQuery);
      const response = summary ? { ...buildGeneralHelpResponse(), summary } : buildGeneralHelpResponse();
      return { response, context, suggestions: suggestions.map((s) => ({ label: s.label, message: s.message })) };
    }

    let outcome: TurnOutcome;

    switch (plan.intent) {
      case "LOW_STOCK": {
        const items = await getLowStockItems();
        outcome = { response: buildLowStockResponse(items), contextPatch: { lastIntent: CTX.INVENTORY } };
        break;
      }
      case "SALES_SUMMARY": {
        const result = await getSalesSummary(plan.period ?? { type: "TODAY" });
        outcome = { response: buildSalesSummaryResponse(result), contextPatch: { lastIntent: CTX.SALES, period: result.period } };
        break;
      }
      case "TOP_SELLING": {
        const result = await getTopSellingProducts(plan.period ?? { type: "TODAY" });
        outcome = { response: buildTopSellingResponse(result.period, result.rows), contextPatch: { lastIntent: CTX.SALES, period: result.period } };
        break;
      }
      case "GLOBAL_CASE_COUNT": {
        const summary = await getGlobalCaseInventorySummary();
        outcome = { response: buildGlobalCaseCountResponse(summary), contextPatch: { lastIntent: CTX.INVENTORY } };
        break;
      }
      case "GLOBAL_CASE_INVENTORY": {
        const summary = await getGlobalCaseInventorySummary();
        outcome = { response: buildGlobalCaseInventoryResponse(summary), contextPatch: { lastIntent: CTX.INVENTORY } };
        break;
      }
      case "REP_PAYMENTS_SUMMARY": {
        const result = await getRepPaymentsSummary(plan.period ?? { type: "TODAY" });
        outcome = { response: buildRepPaymentsSummaryResponse(result), contextPatch: { lastIntent: CTX.REP, period: result.period } };
        break;
      }
      case "REP_SALES_SUMMARY": {
        const result = await getRepSalesSummary(plan.period ?? { type: "TODAY" });
        outcome = { response: buildRepSalesSummaryResponse(result), contextPatch: { lastIntent: CTX.REP, period: result.period } };
        break;
      }
      case "MERCHANT_ACCOUNTS_OVERVIEW": {
        const result = await getMerchantAccountsOverview();
        outcome = { response: buildMerchantAccountsOverviewResponse(result), contextPatch: { lastIntent: CTX.MERCHANT } };
        break;
      }
      case "INVENTORY_SUMMARY":
      case "STOCK_LOCATIONS":
      case "REP_INVENTORY":
      case "PRODUCT_PRICE": {
        const resolution = await resolveEntity({ entityKind: plan.entityKind, entityQuery: plan.entityQuery, rawMessage: input.message, context, learnedHint: input.learnedHint });
        outcome = await handleCatalogIntent(plan.intent, resolution, plan.materialFilter, plan.productScope);
        break;
      }
      case "PRODUCT_SALES": {
        const resolution = await resolveEntity({ entityKind: plan.entityKind, entityQuery: plan.entityQuery, rawMessage: input.message, context, learnedHint: input.learnedHint });
        outcome = await handleProductSales(resolution, plan.period, plan.productScope);
        break;
      }
      case "MERCHANT_BALANCE":
      case "MERCHANT_ACTIVITY": {
        const resolution = await resolveEntity({ entityKind: "MERCHANT", entityQuery: plan.entityQuery, rawMessage: input.message, context, learnedHint: input.learnedHint });
        outcome = await handleMerchantIntent(plan.intent, resolution);
        break;
      }
      case "REP_SUMMARY": {
        const resolution = await resolveEntity({ entityKind: "REP", entityQuery: plan.entityQuery, rawMessage: input.message, context, learnedHint: input.learnedHint });
        outcome = await handleRepSummary(resolution, plan.period);
        break;
      }
      case "REP_COLLECTION_ACTIVITY": {
        // "احمد كم قبض اليوم؟" — REP_THEN_MERCHANT tries a rep candidate
        // first (the far more common real meaning of "قبض"/"تحصيل" tied to
        // a name), falling back to a merchant only when no real rep exists
        // at all — see local/types.ts's own doc comment on the hint.
        const resolution = await resolveEntity({ entityKind: "REP_THEN_MERCHANT", entityQuery: plan.entityQuery, rawMessage: input.message, context, learnedHint: input.learnedHint });
        outcome = await handleRepCollectionActivity(resolution, plan.period);
        break;
      }
      default:
        outcome = { response: buildGeneralHelpResponse(), contextPatch: {} };
    }

    const nextContext: OviAiContext = { ...context, ...outcome.contextPatch };
    return { response: outcome.response, context: nextContext, suggestions: buildFollowUpSuggestions(nextContext), candidates: outcome.candidates };
  } catch (error) {
    console.error("[ovi-ai-local] turn failed", { message: error instanceof Error ? error.message : "unknown" });
    return { response: buildErrorResponse(), context, suggestions: [] };
  }
}

/** Resolution outcomes shared by every entity-scoped intent: AMBIGUOUS/
 * NOT_FOUND never reach a tool call at all — only a clarification or
 * closest-candidates message, exactly mirroring the old orchestrator's
 * deterministic short-circuit (never left to guesswork). NOT_FOUND always
 * uses buildNoMatchResponse (never the generic "GENERAL_HELP" text) even
 * with zero candidates — a correctly-routed question that found no real
 * match ("ما لقيت نتيجة مطابقة") reads very differently from "I didn't
 * understand the question type at all" ("حدد أكثر شو حاب تعرف"), and
 * conflating the two (a real production failure this round audited) made a
 * correctly-classified MERCHANT_ACTIVITY search with a genuinely obscure
 * name look identical to a total routing failure. */
function unresolvedOutcome(resolution: EntityResolutionResult): TurnOutcome | null {
  if (resolution.status === "AMBIGUOUS") {
    return { response: buildClarificationResponse(true), contextPatch: {}, candidates: resolution.candidates };
  }
  if (resolution.status === "NOT_FOUND") {
    const hasCandidates = Boolean(resolution.candidates && resolution.candidates.length > 0);
    return { response: buildNoMatchResponse(hasCandidates), contextPatch: {}, candidates: resolution.candidates };
  }
  return null;
}

async function handleCatalogIntent(
  intent: "INVENTORY_SUMMARY" | "STOCK_LOCATIONS" | "REP_INVENTORY" | "PRODUCT_PRICE",
  resolution: EntityResolutionResult,
  materialFilter: string | null,
  productScope: import("@/lib/ai/local/product-scope").RequestedProductScope | null,
): Promise<TurnOutcome> {
  const unresolved = unresolvedOutcome(resolution);
  if (unresolved) return unresolved;
  if (resolution.status !== "RESOLVED" || (resolution.type !== "PRODUCT" && resolution.type !== "PHONE_MODEL") || !resolution.id) {
    return { response: buildGeneralHelpResponse(), contextPatch: {} };
  }

  if (intent === "PRODUCT_PRICE") {
    if (resolution.type === "PHONE_MODEL") {
      // A phone model itself carries no price — the real priced rows are
      // its compatible accessory products. Ask which one, with real
      // query-rewrite suggestions built from the resolved label (never a
      // second, silent guess at which accessory the user meant).
      return { response: { kind: "TEXT", title: resolution.label, summary: `${resolution.label} موديل جهاز، حدد الصنف اللي بدك تعرف سعره (مثلاً جفرة معيّنة).` }, contextPatch: entityContextPatch(resolution) };
    }
    const details = await getProductDetails(resolution.id);
    if (!details) return { response: buildNoMatchResponse(false), contextPatch: {} };
    return { response: buildProductPriceResponse(details), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.PRODUCT_DETAILS } };
  }

  if (intent === "STOCK_LOCATIONS") {
    const result = await getStockLocationsForItem(resolution.type, resolution.id, productScope);
    if (!result) return { response: buildNoMatchResponse(false), contextPatch: {} };
    return { response: buildStockLocationsResponse(result), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.INVENTORY, productScope } };
  }

  if (intent === "REP_INVENTORY") {
    const result = await getRepInventoryBreakdown(resolution.type, resolution.id, productScope);
    if (!result) return { response: buildNoMatchResponse(false), contextPatch: {} };
    return { response: buildRepInventoryResponse(result.label, result.warehouseQuantity, result.reps), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.INVENTORY, productScope } };
  }

  const summary = await getInventorySummary(resolution.type, resolution.id, productScope);
  if (!summary) return { response: buildNoMatchResponse(false), contextPatch: {} };
  return { response: buildInventoryResponse(summary, materialFilter, productScope), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.INVENTORY, productScope } };
}

async function handleProductSales(
  resolution: EntityResolutionResult,
  period: import("@/lib/ai/tools/sales").SalesPeriodInput | null,
  productScope: import("@/lib/ai/local/product-scope").RequestedProductScope | null,
): Promise<TurnOutcome> {
  const unresolved = unresolvedOutcome(resolution);
  if (unresolved) return unresolved;
  if (resolution.status !== "RESOLVED" || !resolution.id || !resolution.type) return { response: buildGeneralHelpResponse(), contextPatch: {} };

  // AMBIGUOUS_NAME resolution may have landed on a REP (e.g. "مبيعات أحمد
  // اليوم؟") rather than a product — answer with that rep's own summary
  // instead of forcing a product-sales lookup on a person's id.
  if (resolution.type === "REP") {
    return handleRepSummary(resolution, period);
  }
  if (resolution.type !== "PRODUCT" && resolution.type !== "PHONE_MODEL") return { response: buildGeneralHelpResponse(), contextPatch: {} };

  const result = await getProductSales(resolution.type, resolution.id, period ?? { type: "TODAY" }, productScope);
  if (!result) return { response: buildNoMatchResponse(false), contextPatch: {} };
  return { response: buildProductSalesResponse(result), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.SALES, period: result.period, productScope } };
}

async function handleMerchantIntent(intent: "MERCHANT_BALANCE" | "MERCHANT_ACTIVITY", resolution: EntityResolutionResult): Promise<TurnOutcome> {
  const unresolved = unresolvedOutcome(resolution);
  if (unresolved) return unresolved;
  if (resolution.status !== "RESOLVED" || resolution.type !== "MERCHANT" || !resolution.id) return { response: buildGeneralHelpResponse(), contextPatch: {} };

  if (intent === "MERCHANT_BALANCE") {
    const result = await getMerchantAccountSummary(resolution.id);
    if (!result) return { response: buildNoMatchResponse(false), contextPatch: {} };
    return { response: buildMerchantAccountResponse(result), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.MERCHANT } };
  }

  const rows = await getMerchantRecentActivity(resolution.id);
  return { response: buildMerchantActivityResponse(resolution.label ?? "", rows), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.MERCHANT } };
}

/** "احمد كم قبض اليوم؟" resolved via REP_THEN_MERCHANT: if a real REP
 * candidate resolved, answer with that rep's own snapshot (RepSummary
 * already includes paymentsCollected — never a second, duplicated payment
 * calculation). If REP resolution instead landed on a MERCHANT (no real
 * rep of that name existed), fall back to that merchant's own activity —
 * a defensible, non-fabricating answer for a genuinely confused direction
 * of question, never a guess at a nonexistent rep. */
async function handleRepCollectionActivity(resolution: EntityResolutionResult, period: import("@/lib/ai/tools/sales").SalesPeriodInput | null): Promise<TurnOutcome> {
  const unresolved = unresolvedOutcome(resolution);
  if (unresolved) return unresolved;
  if (resolution.status !== "RESOLVED" || !resolution.id) return { response: buildGeneralHelpResponse(), contextPatch: {} };

  if (resolution.type === "MERCHANT") return handleMerchantIntent("MERCHANT_ACTIVITY", resolution);
  if (resolution.type !== "REP") return { response: buildGeneralHelpResponse(), contextPatch: {} };
  return handleRepSummary(resolution, period);
}

async function handleRepSummary(resolution: EntityResolutionResult, period: import("@/lib/ai/tools/sales").SalesPeriodInput | null): Promise<TurnOutcome> {
  const unresolved = unresolvedOutcome(resolution);
  if (unresolved) return unresolved;
  if (resolution.status !== "RESOLVED" || resolution.type !== "REP" || !resolution.id) return { response: buildGeneralHelpResponse(), contextPatch: {} };

  const result = await getRepSummary(resolution.id, period ?? undefined);
  if (!result) return { response: buildNoMatchResponse(false), contextPatch: {} };
  return { response: buildRepSummaryResponse(result), contextPatch: { ...entityContextPatch(resolution), lastIntent: CTX.REP } };
}
