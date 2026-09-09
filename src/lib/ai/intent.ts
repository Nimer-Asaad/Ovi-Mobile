/** Deterministic business-intent/category classifier — originally the input
 * to the (now removed) LLM grounding safeguard; since Ovi AI's local V1
 * redesign it is the CATEGORY layer the local router (src/lib/ai/local/
 * router.ts) builds its more specific LocalIntent decisions on top of. Pure
 * function, no DB, no provider call — plain keyword + context matching,
 * deliberately conservative: when in doubt about WHETHER data is needed, it
 * says YES; it is never exhaustive about WHICH exact category a sentence
 * maps to (natural language is too varied for a keyword list to fully
 * capture). `matchesTerm`/`includesAny` are exported so the local router can
 * reuse the exact same word-boundary-aware matching (never a second,
 * subtly-different keyword matcher). */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";
import { detectDatePeriod } from "@/lib/ai/language/dates";
import { collapseExpressiveRepeats, stripArabicClitic, stripPossessiveSuffix } from "@/lib/ai/language/dialect";
import type { OviAiContext } from "@/lib/ai/types";

/** The closed set of real business-fact categories a question can require —
 * the coarse layer src/lib/ai/local/router.ts's own, more specific
 * LocalIntent decisions are built on top of. Not a general-purpose
 * taxonomy; every value here exists because at least one real Ovi AI tool
 * (src/lib/ai/tools/**.ts) actually returns that kind of fact. */
export type OviDataCategory = "CATALOG" | "INVENTORY" | "PRICE" | "SALES" | "PAYMENTS" | "MERCHANT_ACCOUNT" | "MERCHANT_ACTIVITY" | "REP";

export interface IntentClassification {
  requiresData: boolean;
  /** Empty when requiresData is false. Multiple categories mean the message
   * is a genuine COMPOUND question (e.g. "كم عنا A26 وكم بعنا منه؟" ->
   * INVENTORY + SALES) — the grounding rule requires ALL of them to be
   * covered by this turn's own successful tool executions before a final
   * answer is allowed; it is never satisfied by "any one of them". */
  categories: OviDataCategory[];
}

const norm = (term: string) => normalizeSearchText(term);

/** Word-boundary-aware keyword matching — a single-word keyword ("عنا")
 * must appear as its OWN token in the message, never merely as a substring
 * of a longer, unrelated word ("بعنا" = "we sold" contains the exact
 * characters "عنا" but is a completely different word/meaning). A
 * multi-word keyword phrase ("كم على") is matched as a substring of the
 * whole normalized message instead, since token-splitting would lose the
 * adjacency that makes it meaningful. This fixed a real bug found by
 * REQUIRED TEST F in this round: "بعنا" (SALES) was being misclassified as
 * also requiring INVENTORY purely because it happens to end in "عنا".
 *
 * A multi-word term is matched as a CONTIGUOUS TOKEN SUBSEQUENCE
 * (containsTokenPhrase), never a raw substring of the joined message
 * string — the same word-boundary care the single-word branch already
 * has, extended to phrases. Found necessary this round: a plain
 * `normalizedMessage.includes(normalizedTerm)` let the phrase "شو ضل"
 * (LOW_STOCK_WORDS) accidentally match INSIDE "شو ضلنا" ("what's left OF
 * X", a normal entity-scoped INVENTORY question — "ضلنا" just happens to
 * start with the same three letters as "ضل"), wrongly promoting it to a
 * company-wide low-stock question. */
function containsTokenPhrase(messageTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0 || phraseTokens.length > messageTokens.length) return false;
  for (let start = 0; start <= messageTokens.length - phraseTokens.length; start++) {
    if (phraseTokens.every((word, offset) => messageTokens[start + offset] === word)) return true;
  }
  return false;
}

export function matchesTerm(messageTokens: string[], normalizedMessage: string, term: string): boolean {
  const normalizedTerm = norm(term);
  if (normalizedTerm.includes(" ")) {
    return containsTokenPhrase(messageTokens, normalizedTerm.split(" ").filter(Boolean));
  }
  return messageTokens.includes(normalizedTerm);
}

export const includesAny = (messageTokens: string[], normalizedMessage: string, terms: string[]) => terms.some((term) => matchesTerm(messageTokens, normalizedMessage, term));
/** DOMAIN_GLOSSARY's index signature makes a lookup `string[] | undefined`
 * under this project's `noUncheckedIndexedAccess` — every key referenced
 * below is always actually present, but this keeps the access honest for
 * the type checker without a non-null assertion. */
const glossary = (key: keyof typeof DOMAIN_GLOSSARY): string[] => DOMAIN_GLOSSARY[key] ?? [];

const INVENTORY_EXTRA = ["مخزون", "مخزن", "متوفر", "موجود", "وين", "فين", "كمية", "كميات", "يخلص", "نواقص", "عنا", "عندنا", "عندكم", "stock", "inventory", "available", "availability", "quantity"];
const PRICE_EXTRA = ["سعر", "اسعار", "أسعار", "price"];
const SALES_EXTRA = ["انباع", "أكثر مبيعا", "اكثر مبيعا", "sales", "sold", "top selling"];
const PAYMENTS_EXTRA = ["قبض", "payment"];
const MERCHANT_ACCOUNT_EXTRA = ["كم على", "debt"];
const REP_EXTRA = ["مندوب", "مندوبين", "rep", "representative"];
const MERCHANT_ACTIVITY_EXTRA = ["حركة", "حركات"];
const CATALOG_EXTRA = ["صنف", "أصناف", "اصناف", "منتج", "منتجات", "product", "products", "catalog"];
/** "آخر"/"اخر" ("last/most recent" — both the standard hamza-madda spelling
 * and the common missing-hamza colloquial spelling, part of the
 * Palestinian-dialect/typo-tolerance upgrade) — a marker word, not a
 * category on its own; see the override logic below. */
const LAST_ACTIVITY_MARKERS = ["آخر", "اخر"] as const;

/** Detects every category a raw (already-normalized) message keyword-
 * matches. Categories can co-occur freely (a compound question legitimately
 * triggers more than one — see IntentClassification's own doc comment). */
function detectCategoriesFromKeywords(normalized: string): Set<OviDataCategory> {
  const categories = new Set<OviDataCategory>();
  const tokens = normalized.split(" ").filter(Boolean);
  // Clitic- AND suffix-aware — not just plain includesAny — so an attached
  // definite article/preposition ("المحصلة", "بالمفرق") OR a possessive
  // suffix ("تحصيلنا" -> "تحصيل") still registers against a bare glossary
  // term, the same class of gap already fixed for language/features.ts's
  // own ranking/topSelling/retail/etc. checks (found this round: "قديش
  // تحصيلنا مبارح؟" fell all the way to GENERAL_HELP because classifyIntent
  // only ever declitic'd, never de-suffixed). Reimplemented locally (not
  // imported from language/lexicon.ts's matchesLexicalGroup) to avoid a
  // circular import — lexicon.ts itself imports `includesAny` from this
  // very file.
  const declitic = tokens.map(stripArabicClitic);
  const desuffixed = tokens.flatMap((token) => stripPossessiveSuffix(token));
  const has = (terms: string[]) => includesAny(tokens, normalized, terms) || includesAny(declitic, normalized, terms) || includesAny(desuffixed, normalized, terms);

  if (
    has(glossary("CASE_COVER")) ||
    // SCREEN_PROTECTOR was missing from this list — found this round via
    // corpus testing: a bare "قزازة A26"/"screen protector A26" (a real
    // accessory-category word + a model code, no other action word at
    // all) fell all the way to GENERAL_HELP while the exact same shape of
    // question about a CASE_COVER word ("غطاء A26") correctly resolved to
    // INVENTORY_SUMMARY — an inconsistency with no principled reason,
    // since both are equally real accessory categories.
    has(glossary("SCREEN_PROTECTOR")) ||
    has(glossary("RANGE")) ||
    has(glossary("LEATHER")) ||
    has(glossary("CLEAR")) ||
    has(glossary("MAGSAFE")) ||
    has(glossary("ULTRA")) ||
    has(glossary("WAREHOUSE")) ||
    has(INVENTORY_EXTRA)
  ) {
    categories.add("INVENTORY");
  }

  // REP_CAR wording ("سيارة"/"المندوب"...) means both "car stock" AND "which
  // rep" at once — matches the "أحمد شو معه بالسيارة؟ -> INVENTORY + REP"
  // worked example directly. EXCEPT "سيارة"/"سيارات" specifically when
  // immediately preceded by a catalog compound-noun word ("شاحن سيارة" —
  // a car CHARGER, a real product name, never a rep's own vehicle) — the
  // same exclusion language/features.ts's own hasGenuineRepCarSignal
  // applies, reimplemented locally here (not imported — would create a
  // circular import, features.ts itself imports `includesAny` from this
  // file) so this file's independent REP_CAR check doesn't reintroduce
  // the exact bug that guard exists to fix.
  const nonCarRepCarTerms = glossary("REP_CAR").filter((term) => norm(term) !== norm("سيارة") && norm(term) !== norm("سيارات"));
  const carCompoundPreceders = ["شاحن", "حامل", "كفر", "كفره", "جفر", "جفره", "جراب", "غطاء", "غطا"].map(norm);
  const carWords = new Set([norm("سيارة"), norm("سيارات")]);
  const isCarToken = (token: string) => {
    const declitic = stripArabicClitic(token);
    if (carWords.has(declitic)) return true;
    return stripPossessiveSuffix(token).some((stem) => carWords.has(stem)) || stripPossessiveSuffix(declitic).some((stem) => carWords.has(stem));
  };
  const hasGenuineRepCar =
    has(nonCarRepCarTerms) || tokens.some((token, index) => isCarToken(token) && !carCompoundPreceders.includes(stripArabicClitic(tokens[index - 1] ?? "")));
  if (hasGenuineRepCar) {
    categories.add("INVENTORY");
    categories.add("REP");
  }

  if (has(PRICE_EXTRA)) categories.add("PRICE");
  if (has(glossary("SALE")) || has(SALES_EXTRA)) categories.add("SALES");
  if (has(glossary("PAYMENT")) || has(PAYMENTS_EXTRA)) categories.add("PAYMENTS");
  if (has(glossary("DEBT")) || has(MERCHANT_ACCOUNT_EXTRA)) categories.add("MERCHANT_ACCOUNT");
  if (has(REP_EXTRA)) categories.add("REP");
  if (has(MERCHANT_ACTIVITY_EXTRA)) categories.add("MERCHANT_ACTIVITY");
  if (has(CATALOG_EXTRA)) categories.add("CATALOG");

  // "آخر دفعة"/"آخر بيع" ("last payment"/"last sale") is a merchant/rep
  // ACTIVITY lookup — get_merchant_account_summary/get_merchant_recent_activity
  // territory (both genuinely return lastPaymentAt/lastSaleAt or a recent-
  // activity list) — NOT a generic company-wide payments/sales KPI request
  // (that phrasing looks more like "دفعات اليوم"/"مبيعات الشهر", with no
  // "آخر"). A narrow, deliberate override for exactly this common phrasing
  // — see the module doc comment on why this stays intentionally non-
  // exhaustive rather than a full NLP disambiguator.
  // "آخر" (substring-matched, as before — low collision risk with real
  // words). "اخر" (no hamza-madda) is matched as an EXACT TOKEN only —
  // substring-matching it too would false-positive inside common unrelated
  // words that happen to contain the same three letters ("اخرى" = "other",
  // "تاخر" = "delayed").
  // A "last N days/weeks" PERIOD phrase ("آخر 3 أيام", "آخر يومين", "آخر
  // أسبوع") also contains the literal substring "آخر"/"اخر" but means
  // something entirely different from "آخر دفعة"/"آخر بيع" ("last
  // payment"/"last sale") — a pure count-of-days specifier, not an
  // activity-lookup marker. Reuses dates.ts's own LAST_N_DAYS detection
  // (never a second, duplicated day-count regex) to tell the two apart —
  // found via this round's own corpus testing ("كم بعنا آخر 3 أيام"، a
  // bare company-wide sales question, was being wrongly reclassified into
  // a merchant-activity lookup with no merchant even named).
  const isLastNDaysPeriodPhrase = detectDatePeriod(normalized)?.type === "LAST_N_DAYS";
  const hasLastMarker =
    !isLastNDaysPeriodPhrase &&
    (normalized.includes(norm(LAST_ACTIVITY_MARKERS[0])) || tokens.includes(norm(LAST_ACTIVITY_MARKERS[1])));
  // "قبض"/"تحصيل" tied to "آخر" ("قديش قبض احمد اخر مرة؟") is a REP
  // collection question, never a merchant lookup — this override doesn't
  // know about payment DIRECTION (router.ts's own REP_THEN_MERCHANT
  // hint), so it must not delete "PAYMENTS" here either, or router.ts's
  // own REP_COLLECTION_ACTIVITY branch (which needs that category) never
  // gets a chance to run at all. A small local word check (not imported
  // from language/lexicon.ts's REP_COLLECTION_WORDS — would be a circular
  // import) mirroring the same direction distinction router.ts uses.
  const hasLocalCollectionWording = ["قبض", "قبضوا", "قبضنا", "تحصيل", "تحصيلا", "تحصيلات", "محصلة", "استلم", "استلمنا", "حصلوا", "حصلوها", "مقبوض", "وصل", "وصلنا"].some(
    (word) => tokens.includes(norm(word)) || desuffixed.includes(norm(word)),
  );
  if (hasLastMarker && categories.has("PAYMENTS") && !hasLocalCollectionWording) {
    categories.delete("PAYMENTS");
    categories.add("MERCHANT_ACTIVITY");
  }
  if (hasLastMarker && categories.has("SALES")) {
    categories.delete("SALES");
    categories.add("MERCHANT_ACTIVITY");
  }

  return categories;
}

/** Short, purely conversational messages that never need business data
 * regardless of active context — never force a tool call for small talk.
 * Exported so the local router (src/lib/ai/local/router.ts) can special-case
 * a friendly reply distinct from its "message too vague, here's how to ask"
 * GENERAL_HELP reply. */
export const CONVERSATIONAL_CLOSERS: string[] = ["شكرا", "شكراً", "تمام", "حلو", "أوك", "اوك", "ok", "okay", "thanks", "thank you", "hi", "hello", "مرحبا", "اهلا", "أهلا", "السلام عليكم", "يعطيك العافية"].map(norm);

/** Maps a prior turn's `lastIntent` label to the category set a contextless
 * follow-up ("مين معه منهم؟", "وأحمد؟") most likely still needs — used ONLY
 * as a fallback when the current message itself carries no keyword of its
 * own. "MERCHANT" is deliberately broad (both MERCHANT_ACCOUNT and
 * MERCHANT_ACTIVITY) since a bare merchant-topic follow-up could mean
 * either without a category-specific fact tool's own keyword. */
const LAST_INTENT_CATEGORIES: Record<string, OviDataCategory[]> = {
  INVENTORY: ["INVENTORY"],
  PRODUCT_DETAILS: ["CATALOG", "PRICE"],
  MERCHANT: ["MERCHANT_ACCOUNT", "MERCHANT_ACTIVITY"],
  REP: ["REP"],
  SALES: ["SALES"],
};

function activeContextCategories(context: OviAiContext): OviDataCategory[] {
  if (context.lastIntent && LAST_INTENT_CATEGORIES[context.lastIntent]) {
    return LAST_INTENT_CATEGORIES[context.lastIntent]!;
  }
  const hasAnyResolvedEntity = Boolean(context.resolvedProductId || context.resolvedPhoneModelId || context.resolvedMerchantId || context.resolvedRepId);
  return hasAnyResolvedEntity ? ["INVENTORY"] : [];
}

/** The business-intent classifier. See the module doc comment for the
 * conservative "when in doubt about NEEDING data, say yes; never exhaustive
 * about WHICH exact category" design. */
export function classifyIntent(userMessage: string, context: OviAiContext): IntentClassification {
  // Same expressive-repeat collapsing language/features.ts's own
  // extractQueryFeatures applies ("لزقاااات" -> "لزقات") — this is the
  // ONLY caller of classifyIntent (router.ts), so applying it here too
  // costs nothing and keeps the two independent normalization passes
  // router.ts relies on agreeing with each other. Found missing this
  // round: without it, a real category keyword survived intact in
  // features.ts's own (collapsed) productScope detection while
  // classifyIntent's (uncollapsed) keyword check silently missed the same
  // word, so the two disagreed on whether the message named a category at
  // all for an expressively-typed message.
  const normalized = collapseExpressiveRepeats(normalizeSearchText(userMessage));
  if (!normalized || CONVERSATIONAL_CLOSERS.includes(normalized)) {
    return { requiresData: false, categories: [] };
  }

  const keywordCategories = detectCategoriesFromKeywords(normalized);
  if (keywordCategories.size > 0) {
    return { requiresData: true, categories: [...keywordCategories] };
  }

  const contextCategories = activeContextCategories(context);
  if (contextCategories.length > 0) {
    return { requiresData: true, categories: contextCategories };
  }

  return { requiresData: false, categories: [] };
}
