/** Deterministic local query router — replaces the LLM entirely for "what is
 * the user asking, about what, for which period". Pure function, no DB, no
 * network. Delegates language UNDERSTANDING (Palestinian colloquial + MSA +
 * mixed Arabic/English + typo/dialect tolerance) to language/features.ts,
 * and only decides intent PRECEDENCE + confidence + smart-clarification
 * suggestions here — see LocalQueryPlan's own doc comment for the exact
 * decision fields. Never exhaustive of every possible Arabic phrasing (that
 * would be an unmaintainable wall of sentence-specific `if`s) — conservative
 * like classifyIntent itself: when unsure, prefer GENERAL_HELP (ask the
 * user to clarify, with real suggestions) over guessing wrong. */

import { classifyIntent, CONVERSATIONAL_CLOSERS } from "@/lib/ai/intent";
import { normalizeSearchText } from "@/lib/ai/normalization";
import { stripArabicClitic } from "@/lib/ai/language/dialect";
import { extractQueryFeatures, type QueryFeatures } from "@/lib/ai/language/features";
import { isPrefixOfAny } from "@/lib/ai/language/lexicon";
import { REP_WORDS } from "@/lib/ai/language/lexicon";
import type { OviAiContext } from "@/lib/ai/types";
import type { EntityKindHint, LocalQueryPlan } from "@/lib/ai/local/types";

const norm = (term: string) => normalizeSearchText(term);

/** The local router's single entry point — deterministic, synchronous, no
 * DB. See LocalQueryPlan's own doc comment for the exact decision fields.
 * `entityKind: "NONE"` intents always carry `entityQuery: ""`/`period`
 * cleared to whatever's actually meaningful for that intent, matching the
 * existing convention every downstream consumer (engine.ts) already relies
 * on. */
export function parseLocalQuery(message: string, context: OviAiContext): LocalQueryPlan {
  const features = extractQueryFeatures(message, context);
  const { tokens, normalizedText: normalized, entityQuery, productScope, materialFilter, datePeriod: period, actionFeatures, confidence } = features;
  // "قبضنا من محمد؟" ("we collected FROM Mohammed") flips a collection VERB
  // right back to merchant-direction — "من" marks Mohammed as the SOURCE
  // being collected FROM (a merchant paying), not the collector. Computed
  // once up front since it's needed by two separate PAYMENTS-direction
  // guards below. See those call sites for the full reasoning.
  const collectedFromSomeone = tokens.includes(norm("من"));

  if (!normalized) {
    return plan("GENERAL_HELP", "NONE", { entityQuery: "", period: null, materialFilter: null, productScope: null, confidence });
  }

  if (actionFeatures.write) {
    return plan("READ_ONLY_REFUSAL", "NONE", { entityQuery: "", period: null, materialFilter: null, productScope: null, confidence: "HIGH" });
  }

  if (CONVERSATIONAL_CLOSERS.includes(normalized)) {
    return plan("CONVERSATIONAL", "NONE", { entityQuery: "", period: null, materialFilter: null, productScope: null, confidence: "HIGH" });
  }

  const hasReusableEntityInContext = Boolean(context.resolvedProductId || context.resolvedPhoneModelId);

  // LOW_STOCK — checked before generic INVENTORY: a company-wide question,
  // never entity-scoped, even if a stray product word appears alongside it.
  if (actionFeatures.lowStock) {
    return plan("LOW_STOCK", "NONE", { entityQuery: "", period, materialFilter, productScope: null, confidence: "HIGH" });
  }

  // GLOBAL_CASE_INVENTORY/GLOBAL_CASE_COUNT — "جميع الجفرات"/"كل الكفرات"/
  // "شو عنا جفرات" with NO specific model/product left over AND nothing
  // reusable in context to scope it to instead (a mid-conversation "شو عنا
  // جفرات؟" about the SAME already-resolved device stays entity-scoped via
  // the INVENTORY_SUMMARY branch further down, never treated as a sudden
  // switch to a company-wide dump). "كم"/"قديش"/"عدد" signal the compact
  // COUNT variant vs the fuller INVENTORY variant. Guarded on NOT having a
  // sales/ranking signal too — "شو اكتر جفر ماشي؟" mentions "جفر" (CASE_COVER)
  // with nothing left over, but it's a TOP_SELLING question, never a
  // company-wide inventory dump (checked further down, once a real sales
  // word/ranking word is present).
  if (productScope === "CASE_COVER" && entityQuery.length === 0 && !hasReusableEntityInContext && !actionFeatures.sales && !features.ranking) {
    const isCountQuestion = features.questionFeatures.howMuch || tokens.includes(norm("عدد"));
    return plan(isCountQuestion ? "GLOBAL_CASE_COUNT" : "GLOBAL_CASE_INVENTORY", "NONE", { entityQuery: "", period: null, materialFilter: null, productScope, confidence: "HIGH" });
  }

  // REP_PAYMENTS_SUMMARY — "دفعات المندوبين مبارح"/"كم قبضوا المندوبين
  // اليوم"/"الشباب قديش قبضوا" — the PLURAL rep wording (every rep,
  // company-wide) combined with payment wording, checked BEFORE the
  // REP_CAR/bare-REP branches below so a plural, payments-flavored question
  // is never misrouted to a single rep's own snapshot. "مين قبض اكتر
  // هالشهر؟" has no explicit "مندوبين" word at all — "قبض" (collect) is
  // inherently a REP-side action in this business (a merchant "دفع"s, a rep
  // "يقبض"), so a ranking/"مين" question with payment wording and NO
  // specific merchant name left over is ALSO company-wide rep-payments
  // ranking, never a guess at one particular merchant's own payment.
  const impliedRepPaymentsRanking = (features.ranking || features.questionFeatures.who) && actionFeatures.hasPaymentWording && entityQuery.length === 0;
  if (actionFeatures.repPayments || impliedRepPaymentsRanking) {
    return plan("REP_PAYMENTS_SUMMARY", "NONE", { entityQuery: "", period, materialFilter: null, productScope: null, confidence: "HIGH" });
  }

  // REP_SALES_SUMMARY — "مبيعات المندوبين هالشهر"/"مبيعات الشباب مبارح"
  // (PLURAL rep wording + a sales word) or "مين اكتر مندوب باع اليوم؟"
  // (ranking/"مين" + a sales word + an explicit rep signal, no entity left
  // over) — the exact SALES-side mirror of REP_PAYMENTS_SUMMARY/
  // impliedRepPaymentsRanking directly above, checked here for the same
  // reason: BEFORE the REP_CAR/bare-REP branches below, so a company-wide
  // "which rep sold the most" ranking question is never misrouted to one
  // rep's own snapshot (a real production gap this round's own testing
  // found and fixed). `hasRepSignal` requires an explicit rep-shaped word
  // (never bare ranking+sales alone, which would wrongly hijack a genuine
  // PRODUCT ranking question like "شو اكتر شي ماشي؟" that mentions no rep
  // at all).
  const hasRepSignal = actionFeatures.repCar || actionFeatures.rep || actionFeatures.repPlural;
  const repSalesPlural = actionFeatures.repPlural && actionFeatures.sales;
  const impliedRepSalesRanking = (features.ranking || features.questionFeatures.who) && actionFeatures.sales && entityQuery.length === 0 && hasRepSignal;
  if (repSalesPlural || impliedRepSalesRanking) {
    return plan("REP_SALES_SUMMARY", "NONE", { entityQuery: "", period, materialFilter: null, productScope: null, confidence: "HIGH" });
  }

  // REP_CAR wording ("سيارة"/"مندوب"/"عربة"/"محمل"...) — a model-code anchor
  // present (or an explicit "مين معه" question-who marker) means the
  // question is about a PRODUCT's spread across reps (REP_INVENTORY,
  // scope-aware); otherwise it's about one rep's own snapshot (REP_SUMMARY).
  // "مين معه جفرات A26؟" carries the SAME "who has this" meaning even with
  // no explicit سيارة/مندوب word at all — a real "معه" relation word + a
  // "مين" question + a genuine model-code anchor is enough on its own to
  // mean REP_INVENTORY (never for a bare name with no product code, which
  // stays too ambiguous to assume).
  const impliedRepInventory = features.questionFeatures.who && features.relation && features.hasModelCodeAnchor;
  // "عند احمد A26"/"احمد معه A26" — a bare relation word ("عند"/"معه"/
  // "عنده") + a real model-code anchor + a genuine name left over, with NO
  // "مين" question word at all (a real, disclosed gap the previous round
  // left as a safe-but-unhelpful GENERAL_HELP clarification). This never
  // GUESSES which rep — it still resolves the PRODUCT (entityKind CATALOG,
  // unchanged resolution path) and shows the real, complete per-rep
  // breakdown getRepInventoryBreakdown already returns, so the user can see
  // for themself whether Ahmad is really in it; never fabricates a rep's
  // stock, never invents a "yes"/"no" the real data doesn't support.
  // Requires a genuine NAME left over — not just the model code itself
  // ("في عندكم A26؟"/"عنده A26 كم" name nobody in particular, "عندكم"/
  // "عنده" alone with no person; entityQuery would be just "a26" once the
  // relation word strips out, which must NOT be mistaken for "احمد a26").
  const entityQueryWithoutModelCode = entityQuery
    .split(" ")
    .filter((token) => !/\d/.test(token))
    .join(" ")
    .trim();
  const bareRelationInventory = features.relation && features.hasModelCodeAnchor && entityQueryWithoutModelCode.length > 0;
  if (actionFeatures.repCar || impliedRepInventory || bareRelationInventory) {
    // Deliberately narrower than bare questionFeatures.who — "مين اكتر
    // مندوب باع؟" ("which rep sold the most?") has "مين" + "مندوب" (so
    // actionFeatures.repCar fires) but is a ranking question about a
    // PERSON, not "who has this product" (needs the "معه"/"عنده"-style
    // relation word too, matching the ORIGINAL narrow "مين معه" marker's
    // intent) — REP_INVENTORY only when there's a real product anchor, or
    // a genuine "who has it" relation+question combination.
    if (features.hasModelCodeAnchor || (features.questionFeatures.who && features.relation)) {
      return plan("REP_INVENTORY", "CATALOG", { entityQuery, period, materialFilter, productScope, confidence });
    }
    return plan("REP_SUMMARY", "REP", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }

  const classification = classifyIntent(message, context);
  const categories = new Set(classification.categories);

  // A bare "مندوب"/"rep"/"الشباب" word (no سيارة/عربة wording) — still a
  // rep question (REP_SUMMARY, or REP_PAYMENTS-shaped if plural — already
  // handled above, so this is always the single-rep case by the time we
  // get here).
  if (actionFeatures.rep || categories.has("REP")) {
    return plan("REP_SUMMARY", "REP", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }

  // MERCHANT_ACCOUNTS_OVERVIEW — "حساب التجار"/"ذمم التجار"/"مين عليه
  // أكثر؟"/"شو وضع التجار": an ACCOUNT_OVERVIEW_PHRASES match always means
  // the company-wide ranking (these phrases never name one merchant). A
  // bare "حساب"/"حسابات"/"ذمم" word ONLY means the overview when NOTHING is
  // left over to be a merchant name — "حساب التجار" (entityQuery empty
  // after "التجار" strips as the MERCHANT glossary's plural) is the
  // overview, but "حساب محمد" (entityQuery "محمد") is that ONE merchant's
  // own account (MERCHANT_BALANCE, handled by the MERCHANT_ACCOUNT branch
  // below) — the same bare word, opposite intents, disambiguated only by
  // whether a name survives extraction. This was a real bug found auditing
  // "حساب محمد" before this fix (it incorrectly always fired the overview).
  if (actionFeatures.merchantAccountOverviewPhrase || (actionFeatures.merchantAccountBareWord && entityQuery.length === 0)) {
    return plan("MERCHANT_ACCOUNTS_OVERVIEW", "NONE", { entityQuery: "", period: null, materialFilter: null, productScope: null, confidence: "HIGH" });
  }

  // classifyIntent's own "آخر بيع/دفعة" override (intent.ts) assumes
  // "last sale/payment" always means a MERCHANT's last activity — true for
  // "آخر بيع لمحمد", but not for "آخر عملية بيع لـA26" (the last sale OF a
  // PRODUCT — a real model-code anchor is the strongest signal that "آخر"
  // here scopes a SALE question about that product, not a merchant
  // lookup). Guarded here (never inside intent.ts itself, which has no
  // access to this feature) so it still falls through correctly to the
  // SALES branch further down via `actionFeatures.sales` — the override
  // deleting the SALES category doesn't affect that separate feature.
  // "قبض"/"تحصيل" tied to "آخر" ("آخر تحصيل لأحمد؟") is exactly as much a
  // REP-side collection question as the bare form below — classifyIntent's
  // "آخر" override doesn't know about payment DIRECTION (it has no access
  // to hasCollectionWording), so it's guarded out here too, letting this
  // fall through to the same REP_COLLECTION_ACTIVITY branch as the bare
  // form — never forced into a merchant lookup just because "آخر" is
  // present.
  if (
    categories.has("MERCHANT_ACTIVITY") &&
    !features.hasModelCodeAnchor &&
    !(actionFeatures.hasCollectionWording && !actionFeatures.hasMerchantPaymentWording && !collectedFromSomeone) &&
    !features.isCarCompoundProductOnly
  ) {
    return plan("MERCHANT_ACTIVITY", "MERCHANT", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }
  if (categories.has("MERCHANT_ACCOUNT") || actionFeatures.merchantAccount) {
    return plan("MERCHANT_BALANCE", "MERCHANT", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }
  // A bare PAYMENTS-category question ("محمد متى دفع؟" — no "آخر" word, so
  // classifyIntent's own MERCHANT_ACTIVITY override never fires) that STILL
  // names a specific entity is a merchant-activity lookup, not a company-
  // wide sales/payments summary — the empty-entityQuery PAYMENTS fallback
  // further down only ever covers the OTHER case (no name at all).
  //
  // DIRECTION matters here: a merchant "دفع"s (pays Ovi), a rep "يقبض"/
  // "يحصّل"s (collects on Ovi's behalf) — "احمد كم قبض اليوم؟" is never a
  // merchant lookup just because it names someone and mentions a payment
  // word, and "محمد كم دفع؟" is never treated as a rep's own collection.
  // hasCollectionWording (favored whenever present, even alongside
  // hasMerchantPaymentWording — قبض/تحصيل is the more specific signal) ->
  // REP_COLLECTION_ACTIVITY (REP_THEN_MERCHANT: tries a real rep first,
  // falls back to a merchant only if no rep of that name exists — never
  // guessed from the verb alone when both could plausibly apply, see
  // local/types.ts's own doc comment). Otherwise (دفع/سدد, or no
  // directional word at all) stays the existing MERCHANT_ACTIVITY lookup.
  //
  // "قبضنا من محمد؟"/"استلمنا من محمد؟" ("we collected FROM Mohammed") flips
  // this right back to merchant-direction despite the collection VERB —
  // see `collectedFromSomeone`'s own doc comment at the top of this
  // function. A bare "احمد كم قبض؟" (no "من" at all) keeps the rep-ward
  // reading.
  // "دفعة شاحن سيارة" — the leftover "شاحن سيارة" is a preserved CATALOG
  // compound-product phrase (see language/features.ts's own
  // isCarCompoundProductOnly), never a real person's name; treated as a
  // merchant/rep lookup here would confidently invent a "merchant named
  // شاحن سيارة" search. Falls through instead — with no other action
  // feature left to catch it, this safely lands on GENERAL_HELP
  // (clarify), exactly the "structurally ambiguous -> clarify, never
  // blindly trigger payment" behavior this round's own spec calls for.
  if (categories.has("PAYMENTS") && entityQuery.length > 0 && !isPrefixOfRepWord(entityQuery) && !features.isCarCompoundProductOnly) {
    if (actionFeatures.hasCollectionWording && !collectedFromSomeone) {
      return plan("REP_COLLECTION_ACTIVITY", "REP_THEN_MERCHANT", { entityQuery, period, materialFilter: null, productScope: null, confidence });
    }
    return plan("MERCHANT_ACTIVITY", "MERCHANT", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }

  // A strong LOCATION marker ("وين"/"فين"/"عند مين"/"باي سيارة"...) or a
  // WHERE question word ("أين", MSA) is sufficient on its own — it never
  // needs a SEPARATE inventory-category word alongside it ("عند مين A26؟"
  // names no inventory word at all, but is unambiguously a "where is it"
  // question).
  if (actionFeatures.stockLocation || features.questionFeatures.where) {
    return plan("STOCK_LOCATIONS", "CATALOG", { entityQuery, period, materialFilter, productScope, confidence });
  }

  if (categories.has("PRICE") || actionFeatures.price) {
    return plan("PRODUCT_PRICE", "CATALOG", { entityQuery, period, materialFilter: null, productScope: null, confidence });
  }

  if (categories.has("SALES") || actionFeatures.sales) {
    // Checked unconditionally (not just when entityQuery is empty) — "اكثر
    // شي انباع" leaves "شي" behind as leftover text, which is never a real
    // entity name; a genuine top-selling question is always company-wide.
    // `features.ranking` alone (not just the explicit TOP_SELLING phrase
    // list) also counts here — "شو اكتر جفر ماشي؟" pairs the colloquial
    // "اكتر" ranking word with "ماشي" (SALE glossary) and means exactly the
    // same thing as "الأكثر مبيعاً"; both spellings ("اكثر"/"اكتر") already
    // live in RANKING_WORDS (lexicon.ts), never duplicated here.
    if (actionFeatures.topSelling || features.ranking) {
      return plan("TOP_SELLING", "NONE", { entityQuery: "", period, materialFilter, productScope: productScope, confidence: "HIGH" });
    }
    if (entityQuery.length === 0) {
      return plan("SALES_SUMMARY", "NONE", { entityQuery: "", period, materialFilter, productScope: null, confidence: "HIGH" });
    }
    // A named entity with no digit anchor could be a rep's own sales
    // ("مبيعات أحمد اليوم") just as easily as a product's ("مبيعات سامسونج") —
    // AMBIGUOUS_NAME tells entity-resolution.ts to try REP first, then
    // CATALOG, rather than guessing wrong here with no DB access.
    const entityKind: EntityKindHint = features.hasModelCodeAnchor ? "CATALOG" : "AMBIGUOUS_NAME";
    return plan("PRODUCT_SALES", entityKind, { entityQuery, period, materialFilter, productScope, confidence });
  }

  if (categories.has("PAYMENTS") && entityQuery.length === 0) {
    // A contextless payment follow-up ("هالشهر شو دفع؟" right after "حساب
    // محمد") names no fresh entity of its own, but a real merchant is
    // already resolved in context — this is that merchant's OWN activity,
    // never a sudden switch to a company-wide summary. Checked here
    // (rather than earlier, alongside the other MERCHANT_ACTIVITY branch)
    // specifically because THIS case has no keyword-driven category match
    // pointing at a name — only the empty-entityQuery PAYMENTS fallback
    // reaches this point at all.
    if (context.resolvedMerchantId) {
      return plan("MERCHANT_ACTIVITY", "MERCHANT", { entityQuery: "", period, materialFilter: null, productScope: null, confidence });
    }
    return plan("SALES_SUMMARY", "NONE", { entityQuery: "", period, materialFilter, productScope: null, confidence: "HIGH" });
  }

  // A bare quantity-question word ("قديش"/"كديش"/"كم") + a real model-code
  // anchor, with no other signal at all ("كميييية A26 قديش؟" once the
  // "كمية"/"قديش" words themselves are stripped as leftover noise) still
  // means "how much do we have" in this domain — there's no OTHER reason to
  // ask "how much" about a persisted catalog item.
  if (categories.has("INVENTORY") || categories.has("CATALOG") || actionFeatures.inventory || actionFeatures.inventoryNegative || (features.questionFeatures.howMuch && features.hasModelCodeAnchor)) {
    return plan("INVENTORY_SUMMARY", "CATALOG", { entityQuery, period, materialFilter, productScope, confidence });
  }

  // Last resort before giving up: a bare name + a real relation word
  // ("احمد شو معه؟") with no other signal at all most commonly means "what
  // does this rep have" in this business's own language (a rep's car stock
  // is the thing most often asked about this way) — never assumed for a
  // name that also carries a real model-code anchor (that's a product
  // question, already handled above).
  if (features.relation && entityQuery.length > 0 && !features.hasModelCodeAnchor) {
    return plan("REP_SUMMARY", "REP", { entityQuery, period, materialFilter: null, productScope: null, confidence: "MEDIUM" });
  }

  return plan("GENERAL_HELP", "NONE", { entityQuery, period, materialFilter, productScope: null, confidence: "LOW" });
}

/** Small typed constructor — keeps every branch above a one-liner while
 * still returning the exact LocalQueryPlan shape (including the parser's
 * own confidence, threaded through unchanged by most branches but always
 * explicit so no branch can silently forget it). */
function plan(
  intent: LocalQueryPlan["intent"],
  entityKind: EntityKindHint,
  fields: Pick<LocalQueryPlan, "entityQuery" | "period" | "materialFilter" | "productScope" | "confidence">,
): LocalQueryPlan {
  return { intent, entityKind, ...fields };
}

/** True when `token` is a genuine PREFIX of a rep-related word — "مند" of
 * "مندوب"/"مندوبين". Used only to offer targeted suggestions for an
 * incomplete message, never to silently guess a full intent. */
function isPrefixOfRepWord(token: string): boolean {
  return isPrefixOfAny(token, REP_WORDS);
}

/** A leftover entity-query token that plausibly names a real catalog
 * item — has a digit (a model code) or is short and letter-only (a bare
 * brand/model prefix like "s"/"a"). Used only to pick which SMART
 * clarification shape to offer (section 33) — never to skip real entity
 * resolution. */
function looksLikeCatalogCode(entityQuery: string): boolean {
  return /\d/.test(entityQuery) || entityQuery.replace(/\s+/g, "").length <= 4;
}

/** Small, deterministic, non-DB "your question was too vague" query-rewrite
 * suggestions — built only from the raw leftover text the user actually
 * typed (never invented topics) or a small set of recognized PARTIAL-word
 * patterns (never a full report execution). Returns an optional tailored
 * `summary` alongside the suggestions — when a specific partial pattern is
 * recognized, the reply text itself says so instead of the flat "حدد أكثر
 * شو حاب تعرف." (still shown when nothing more specific was recognized).
 * `rawMessage` is the exact text the user sent; `topic` is the router's own
 * already-cleaned leftover (see language/features.ts's entityQuery). Used
 * by the engine when routing lands on GENERAL_HELP (see runLocalOviTurn). */
export function buildGeneralHelpSuggestions(rawMessage: string, topic: string): { summary: string | null; suggestions: { label: string; message: string }[] } {
  const normalized = norm(rawMessage);
  const tokens = normalized.split(" ").filter(Boolean);

  const hasPaymentsWording = tokens.some((token) => stripArabicClitic(token) === norm("دفعات")) || normalized.includes(norm("دفعات")) || normalized.includes(norm("قبض"));
  const hasRepPrefix = tokens.some((token) => isPrefixOfRepWord(stripArabicClitic(token)));
  if (hasPaymentsWording && hasRepPrefix) {
    return {
      summary: "قصدك دفعات المندوبين؟ حدد الفترة:",
      suggestions: [
        { label: "دفعات المندوبين اليوم", message: "دفعات المندوبين اليوم" },
        { label: "دفعات المندوبين مبارح", message: "دفعات المندوبين مبارح" },
        { label: "دفعات المندوبين هالشهر", message: "دفعات المندوبين هالشهر" },
        { label: "دفعات مندوب معين", message: "دفعات مندوب" },
      ],
    };
  }

  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    return {
      summary: null,
      suggestions: [
        { label: "شو قرب يخلص؟", message: "شو قرب يخلص بالمخزون؟" },
        { label: "مبيعات اليوم", message: "مبيعات اليوم" },
      ],
    };
  }

  // Section 33 "SMART CLARIFICATION": a bare catalog-code-looking leftover
  // ("A26") gets the full capability chip set; a bare name-looking leftover
  // ("محمد") gets a combined merchant/rep chip set (never resolved via a DB
  // call here — GENERAL_HELP stays DB-free, see the module's own "Only
  // entity resolution and factual tools touch DB" invariant) so whichever
  // interpretation is right, one tap away.
  if (looksLikeCatalogCode(trimmedTopic)) {
    return {
      summary: `شو حاب تعرف عن ${trimmedTopic}؟`,
      suggestions: [
        { label: "المخزون", message: `شو عنا ${trimmedTopic}؟` },
        { label: "الجفرات", message: `شو عنا جفرات ${trimmedTopic}؟` },
        { label: "وين موجود؟", message: `وين موجود ${trimmedTopic}؟` },
        { label: "المبيعات", message: `كم بعنا ${trimmedTopic} هالشهر؟` },
        { label: "السعر", message: `سعر ${trimmedTopic}` },
      ],
    };
  }

  return {
    summary: `شو حاب تعرف عن ${trimmedTopic}؟`,
    suggestions: [
      { label: "حسابه", message: `كم على ${trimmedTopic}؟` },
      { label: "آخر دفعة", message: `آخر دفعة لـ ${trimmedTopic} متى؟` },
      { label: "مخزون السيارة", message: `شو معه ${trimmedTopic} بالسيارة؟` },
      { label: "مبيعاته", message: `${trimmedTopic} قديش باع اليوم؟` },
    ],
  };
}

export type { QueryFeatures };
