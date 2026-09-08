/** Deterministic local query router — replaces the LLM entirely for "what is
 * the user asking, about what, for which period". Pure function, no DB, no
 * network — reuses classifyIntent (src/lib/ai/intent.ts) for coarse category
 * detection and layers a small, maintainable set of specific-intent/entity/
 * period/scope/material-filter heuristics on top, exactly mirroring what the
 * old system prompt asked the model to infer by hand. Never exhaustive of
 * every possible Arabic phrasing (that would be an unmaintainable wall of
 * sentence-specific `if`s, which the spec explicitly forbids) — conservative
 * like classifyIntent itself: when unsure, prefer GENERAL_HELP (ask the user
 * to clarify, with real suggestions) over guessing wrong. */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";
import { classifyIntent, includesAny, CONVERSATIONAL_CLOSERS } from "@/lib/ai/intent";
import { extractAnchorTokens } from "@/lib/ai/fuzzy";
import type { OviAiContext } from "@/lib/ai/types";
import type { SalesPeriodInput } from "@/lib/ai/tools/sales";
import type { RequestedProductScope } from "@/lib/ai/local/product-scope";
import type { EntityKindHint, LocalQueryPlan } from "@/lib/ai/local/types";

const norm = (term: string) => normalizeSearchText(term);
const glossary = (key: keyof typeof DOMAIN_GLOSSARY): string[] => DOMAIN_GLOSSARY[key] ?? [];

/** Strips one leading Arabic clitic (definite article "ال"/"لل", or an
 * attached one-letter preposition/conjunction "ب"/"ل"/"و"/"ف"/"ك", including
 * the combined forms "بال"/"وال"/"فال"/"كال") — a small, deliberately
 * non-recursive heuristic (real morphology is out of scope), just enough to
 * make glossary/stopword matching and entity-name extraction work on the
 * attached forms Ovi staff actually type ("بالسيارات", "لمحمد", "الجلد",
 * "للتاجر"). Never applied to fuzzy-scoring itself (fuzzy.ts's own
 * tokenScore already tolerates minor variance) — only to routing/stopword
 * decisions here. */
function stripArabicClitic(token: string): string {
  const combined = ["بال", "وال", "فال", "كال"];
  for (const prefix of combined) {
    if (token.startsWith(prefix) && token.length > prefix.length + 1) return token.slice(prefix.length);
  }
  const definite = ["لل", "ال"];
  for (const prefix of definite) {
    if (token.startsWith(prefix) && token.length > prefix.length + 1) return token.slice(prefix.length);
  }
  const single = ["ب", "ل", "و", "ف", "ك"];
  for (const prefix of single) {
    if (token.startsWith(prefix) && token.length > 3) return token.slice(1);
  }
  return token;
}

/** Word-boundary-aware, CLITIC-AWARE glossary matching — the authoritative
 * check for "does this message mention concept X", stronger than plain
 * includesAny (intent.ts) for the single-word terms this domain's glossary
 * is mostly made of, since it also recognizes an attached form
 * ("بالسيارات", "المندوبين", "للتاجر") by clitic-stripping each token
 * before comparing. Falls back to includesAny for any remaining multi-word
 * term ("حماية شاشة") — clitic-stripping one token doesn't apply to a
 * phrase spanning several. */
function hasGlossaryTerm(tokens: string[], normalized: string, terms: string[]): boolean {
  const normalizedTerms = terms.map(norm);
  if (tokens.some((token) => normalizedTerms.includes(stripArabicClitic(token)))) return true;
  return includesAny(tokens, normalized, terms);
}

/** Glossary groups that are pure CATEGORY/ACTION markers — never part of a
 * real product/model's own persisted name — safe to strip out entirely when
 * isolating a likely entity name. Deliberately EXCLUDES the "variant/
 * material" groups (ULTRA/RANGE/LEATHER/CLEAR/MAGSAFE): those words are
 * often genuinely part of the persisted name ("A26 Ultra", "Range 10") and
 * matter to scoreCandidateLabel's own ranking (fuzzy.ts) — stripping them
 * unconditionally would silently throw away real disambiguating signal (see
 * the module's own "طيب الجلد بس" handling below for how a material word
 * used as a stand-alone FILTER, not part of a new entity name, is detected
 * instead). */
const NON_ENTITY_GLOSSARY_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["CASE_COVER", "SCREEN_PROTECTOR", "WAREHOUSE", "MERCHANT", "PAYMENT", "DEBT", "SALE", "RETURN", "REP_CAR"];
const NON_ENTITY_GLOSSARY_TERMS = NON_ENTITY_GLOSSARY_GROUPS.flatMap((group) => glossary(group)).map(norm);
const MATERIAL_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["LEATHER", "CLEAR", "MAGSAFE", "RANGE", "ULTRA"];

/** Words that carry no entity-identifying meaning by themselves — question
 * words, pronouns referring back to context, period words (handled
 * separately by detectPeriod but still stripped here so they never dilute
 * an entity-name query), generic colloquial/availability filler, bare
 * single-letter prepositions/conjunctions ("لـ محمد" normalizes to a bare
 * "ل" token once the tatweel is stripped — this is NOT the same as the
 * ATTACHED "ل" clitic stripArabicClitic handles; a standalone "ل" token
 * needs to be dropped outright), and company-wide "all/global" words (item
 * I — "جميع"/"كل"/"كامل"/"بالشركة" signal scope, never part of an entity's
 * own name; "بالشركة" itself clitic-strips to "شركة" so only the bare form
 * needs listing here). */
const QUESTION_AND_PRONOUN_WORDS = ["شو", "كم", "مين", "من", "وين", "فين", "ايش", "أي", "اي", "هل", "متى", "منهم", "منه", "منها", "هذا", "هذه", "ذلك", "تلك", "هو", "هي", "هم", "كام"];
const PERIOD_WORDS = ["اليوم", "مبارح", "امبارح", "أمس", "امس", "الاسبوع", "هالاسبوع", "الأسبوع", "الشهر", "هالشهر"];
const ACTION_WORDS = ["معه", "عنده", "عندهم", "باع", "بعنا", "بعت", "دفع", "قبض", "قبضوا", "سعر", "اسعار", "أسعار", "على", "عليه", "له", "آخر", "اخر", "قرب", "يخلص", "نواقص", "خلص"];
const BARE_PREPOSITIONS = ["ل", "ب", "و", "ف", "ك", "عند"];
const GLOBAL_SCOPE_WORDS = ["جميع", "كل", "كامل", "شركة", "عدد"];
const ROUTER_FILLER_WORDS = ["طيب", "بس", "يعني", "لو", "ممكن", "فقط", "بدي", "أبغى", "اريد", "أريد", "اعطيني", "اعطني", "في", "من", "عنا", "عندنا", "عندكم", "موجود", "متوفر", "فيه", "كمية", "كميات"];
const ROUTER_STOPWORDS = new Set([...QUESTION_AND_PRONOUN_WORDS, ...PERIOD_WORDS, ...ACTION_WORDS, ...BARE_PREPOSITIONS, ...GLOBAL_SCOPE_WORDS, ...ROUTER_FILLER_WORDS, ...NON_ENTITY_GLOSSARY_TERMS]);

/** Builds the likely entity-name/model-code leftover of a message: strips
 * every stopword/non-entity-glossary/period/action token (after clitic-
 * stripping each token so "بالسيارات"/"لمحمد"/"للتاجر" match their bare
 * forms), keeping short letter-only tokens ("a", "s") and material/variant
 * words ("ultra", "جلد") intact — both matter to downstream fuzzy scoring.
 * Returns "" when nothing meaningful is left — the caller reads that as "no
 * new entity mentioned, reuse conversation context". */
function extractEntityQuery(normalizedMessage: string): string {
  const kept = normalizedMessage
    .split(" ")
    .filter(Boolean)
    .map((token) => stripArabicClitic(token))
    .filter((token) => token.length > 0 && !ROUTER_STOPWORDS.has(token));
  return kept.join(" ").trim();
}

function isMaterialToken(token: string): boolean {
  const clean = stripArabicClitic(token);
  return MATERIAL_GROUPS.some((group) => glossary(group).map(norm).includes(clean));
}

/** Removes ONLY material/variant tokens from an already-extracted entity
 * query — used to tell "طيب الجلد بس" (whole leftover IS the material word,
 * so there is no new entity, just a filter on the current one) apart from
 * "شو عنا A26 Ultra؟" (the material word is part of a genuinely new,
 * fuller entity name and must stay for scoring). */
function stripMaterialTokens(entityQuery: string): string {
  return entityQuery
    .split(" ")
    .filter(Boolean)
    .filter((token) => !isMaterialToken(token))
    .join(" ")
    .trim();
}

/** A real, persisted-model-code-like anchor is present (a digit-bearing
 * token, or a short-letter-token immediately followed by one) — the same
 * signal extractAnchorTokens (fuzzy.ts) uses to prefer a bounded DB anchor
 * fetch. Used here to decide "REP_INVENTORY (about a product)" vs
 * "REP_SUMMARY (about a person)" when سيارة/مندوب wording is present, and
 * "PRODUCT_SALES about a product" vs "about a rep" for a bare-name sales
 * question. */
function hasModelCodeAnchor(rawMessage: string): boolean {
  return extractAnchorTokens(rawMessage).some((anchor) => /\d/.test(anchor));
}

/** Which explicit product-category scope (if any) THIS message asked for —
 * "CASE_COVER"/"SCREEN_PROTECTOR" — never "OTHER" (nothing is ever
 * explicitly asked for as "other"). null means no scope word was used at
 * all (parseLocalQuery decides separately whether that means "broad" or
 * "carry the prior turn's scope forward" — see its own doc comment). */
function detectRequestedProductScope(tokens: string[], normalized: string): RequestedProductScope | null {
  if (hasGlossaryTerm(tokens, normalized, glossary("CASE_COVER"))) return "CASE_COVER";
  if (hasGlossaryTerm(tokens, normalized, glossary("SCREEN_PROTECTOR"))) return "SCREEN_PROTECTOR";
  return null;
}

const LOW_STOCK_MARKERS = ["يخلص", "نواقص", "خلصت", "قارب", "قرب يخلص", "على وشك", "شارف"];
const TOP_SELLING_MARKERS = ["اكثر", "أكثر", "الاكثر", "الأكثر", "افضل مبيعا", "أفضل مبيعا", "top selling", "top"];
const REP_QUERY_MARKERS = ["مين معه", "مين عنده", "مين عندهم"];
const STOCK_LOCATION_MARKERS = ["وين", "فين"];
const PAYMENTS_WORDING = [...glossary("PAYMENT"), "قبض", "قبضوا", "حصلوا", "حصلوها", "المقبوض"];
const ACCOUNT_OVERVIEW_MARKERS = ["حساب", "حسابات", "ذمم", "مين عليه اكثر", "مين عليه أكثر", "اعلى الذمم", "أعلى الذمم"];

/** Write/mutation intent — "اعمللي مبيعة 10", "الغي الفاتورة", "حول مخزون"...
 * Checked FIRST, before any other classification: Ovi AI local V1 is 100%
 * read-only and must refuse deterministically, never attempt to interpret
 * the rest of such a message as a data question. Deliberately a small,
 * explicit phrase/word list (word-boundary-aware via matchesTerm) rather
 * than a broad heuristic — a false negative here just falls through to a
 * normal (still read-only, tool-only) answer path; a false positive would
 * incorrectly refuse a legitimate question, which the tight list avoids. */
const WRITE_ACTION_MARKERS = [
  "اعمللي", "اعمل لي", "اعمل", "اعملي", "سوي لي", "سوّي لي", "سجل بيع", "سجل مبيعة", "سجل دفعة", "أضف مخزون", "اضف مخزون",
  "انقل مخزون", "حول مخزون", "الغي", "ألغِ", "إلغاء الطلب", "احذف", "امسح", "عدل على", "غيّر على", "عدل السعر", "غير السعر",
  "أنشئ", "انشئ", "create sale", "create payment", "cancel order", "delete",
];

function isWriteAttempt(tokens: string[], normalized: string): boolean {
  return includesAny(tokens, normalized, WRITE_ACTION_MARKERS);
}

/** Detects a material/variant filter mentioned in the message ("طيب الجلد
 * بس" -> "جلد") — used by response-builder.ts to narrow an inventory
 * breakdown to just the requested material, never to change WHICH entity is
 * being asked about. Returns the glossary group's own canonical (first)
 * term as the display/matching label. */
function detectMaterialFilter(tokens: string[]): string | null {
  for (const token of tokens) {
    const clean = stripArabicClitic(token);
    for (const group of MATERIAL_GROUPS) {
      const terms = glossary(group).map(norm);
      if (terms.includes(clean)) return glossary(group)[0] ?? null;
    }
  }
  return null;
}

function detectPeriod(tokens: string[], normalized: string): SalesPeriodInput | null {
  if (normalized.includes(norm("هذا الشهر")) || tokens.includes(norm("هالشهر")) || tokens.includes(norm("الشهر"))) return { type: "THIS_MONTH" };
  if (normalized.includes(norm("هذا الاسبوع")) || tokens.includes(norm("هالاسبوع")) || tokens.includes(norm("الاسبوع")) || tokens.includes(norm("الأسبوع")))
    return { type: "THIS_WEEK" };
  if (tokens.includes(norm("مبارح")) || tokens.includes(norm("امبارح")) || tokens.includes(norm("أمس")) || tokens.includes(norm("امس"))) return { type: "YESTERDAY" };
  if (tokens.includes(norm("اليوم"))) return { type: "TODAY" };
  return null;
}

/** The local router's single entry point — deterministic, synchronous, no
 * DB. See LocalQueryPlan's own doc comment for the exact decision fields. */
export function parseLocalQuery(message: string, context: OviAiContext): LocalQueryPlan {
  const normalized = normalizeSearchText(message);
  const tokens = normalized.split(" ").filter(Boolean);

  if (!normalized) {
    return { intent: "GENERAL_HELP", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null, productScope: null };
  }

  if (isWriteAttempt(tokens, normalized)) {
    return { intent: "READ_ONLY_REFUSAL", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null, productScope: null };
  }

  if (CONVERSATIONAL_CLOSERS.includes(normalized)) {
    return { intent: "CONVERSATIONAL", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null, productScope: null };
  }

  const period = detectPeriod(tokens, normalized);
  const materialFilter = detectMaterialFilter(tokens);
  let entityQuery = extractEntityQuery(normalized);
  const hasReusableEntityInContext = Boolean(context.resolvedProductId || context.resolvedPhoneModelId);
  // A leftover that is ENTIRELY a material/variant word ("طيب الجلد بس")
  // names no new entity at all — it's a filter on whatever is already
  // resolved in context — but ONLY when there IS a resolved entity in
  // context to reuse; a fresh, contextless "جفرة جلد" with nothing to fall
  // back on should still search for the material word itself as a real
  // (if generic) catalog query, rather than emptying out to "no entity" and
  // giving up. A leftover that still has non-material content after
  // removing material words ("شو عنا A26 Ultra؟" -> "a26 ultra") always
  // keeps the material word in place either way, since it's genuinely part
  // of the name.
  if (materialFilter && hasReusableEntityInContext && entityQuery.length > 0 && stripMaterialTokens(entityQuery).length === 0) {
    entityQuery = "";
  }

  // productScope resolution — same "reuse across a contextless follow-up,
  // reset on a fresh entity mention" shape as the material-filter handling
  // above (see LocalQueryPlan.productScope's own doc comment):
  //   - an explicit "جفرات"/"لزقات" word THIS turn always wins;
  //   - no scope word + no new entity named (a pure follow-up like "طيب
  //     الجلد بس" or "مين معه منهم؟") -> keep whatever scope context
  //     already had;
  //   - no scope word but a FRESH entity mention ("شو عنا A26؟" with no
  //     "جفرات") -> broad (null) — a new question with no stated scope
  //     should never silently inherit a filter from a previous, unrelated
  //     entity.
  const requestedScope = detectRequestedProductScope(tokens, normalized);
  const isFollowUpMessage = entityQuery.length === 0;
  const productScope: RequestedProductScope | null = requestedScope ?? (isFollowUpMessage ? (context.productScope ?? null) : null);

  // LOW_STOCK — checked before generic INVENTORY: a company-wide question,
  // never entity-scoped, even if a stray product word appears alongside it.
  if (includesAny(tokens, normalized, LOW_STOCK_MARKERS)) {
    return { intent: "LOW_STOCK", entityKind: "NONE", entityQuery: "", period, materialFilter, productScope: null };
  }

  // GLOBAL_CASE_INVENTORY/GLOBAL_CASE_COUNT — "جميع الجفرات"/"كل الكفرات"/
  // "شو عنا جفرات" with NO specific model/product left over AND nothing
  // reusable in context to scope it to instead (a mid-conversation "شو عنا
  // جفرات؟" about the SAME already-resolved device stays entity-scoped via
  // the INVENTORY_SUMMARY branch further down, never treated as a sudden
  // switch to a company-wide dump). "كم" signals the compact COUNT variant
  // ("كم عدد جميع الجفرات"/"كم عنا جفر") vs the fuller INVENTORY variant.
  if (productScope === "CASE_COVER" && entityQuery.length === 0 && !hasReusableEntityInContext) {
    const isCountQuestion = tokens.includes(norm("كم"));
    return { intent: isCountQuestion ? "GLOBAL_CASE_COUNT" : "GLOBAL_CASE_INVENTORY", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null, productScope };
  }

  // REP_PAYMENTS_SUMMARY — "دفعات المندوبين مبارح"/"كم قبضوا المندوبين
  // اليوم" — the PLURAL "مندوبين" (every rep, company-wide) combined with
  // payment wording, checked BEFORE the REP_CAR/bare-REP branches below so
  // a plural, payments-flavored question is never misrouted to a single
  // rep's own snapshot.
  const hasRepPluralWording = tokens.some((token) => stripArabicClitic(token) === norm("مندوبين"));
  if (hasRepPluralWording && includesAny(tokens, normalized, PAYMENTS_WORDING)) {
    return { intent: "REP_PAYMENTS_SUMMARY", entityKind: "NONE", entityQuery: "", period, materialFilter: null, productScope: null };
  }

  // REP_CAR wording ("سيارة"/"مندوب"...) — checked directly here (not
  // gated on classifyIntent's own categories): classifyIntent's own keyword
  // matcher requires an EXACT token match with no clitic stripping, so an
  // attached form like "بالسيارات" ("مين معه منهم بالسيارات؟") never sets
  // its REP category on its own. hasGlossaryTerm (this module) already
  // handles the attached form correctly, so it's the authoritative check
  // for this specific wording. A model-code anchor present (or an explicit
  // "مين معه" marker) means the question is about a PRODUCT's spread
  // across reps (REP_INVENTORY, scope-aware); otherwise it's about one
  // rep's own snapshot (REP_SUMMARY).
  if (hasGlossaryTerm(tokens, normalized, glossary("REP_CAR"))) {
    if (hasModelCodeAnchor(message) || includesAny(tokens, normalized, REP_QUERY_MARKERS)) {
      return { intent: "REP_INVENTORY", entityKind: "CATALOG", entityQuery, period, materialFilter, productScope };
    }
    return { intent: "REP_SUMMARY", entityKind: "REP", entityQuery, period, materialFilter, productScope: null };
  }

  const classification = classifyIntent(message, context);
  const categories = new Set(classification.categories);

  // A bare "مندوب"/"rep" word (no سيارة wording) — still a rep question.
  if (categories.has("REP")) {
    return { intent: "REP_SUMMARY", entityKind: "REP", entityQuery, period, materialFilter, productScope: null };
  }

  // MERCHANT_ACCOUNTS_OVERVIEW — "حساب التجار"/"ذمم التجار"/"حسابات
  // التجار"/"مين عليه أكثر": the PLURAL merchant word ("تجار", already its
  // own distinct DOMAIN_GLOSSARY.MERCHANT entry from the singular "تاجر")
  // or an explicit account-overview phrase, checked before MERCHANT_
  // ACCOUNT/MERCHANT_ACTIVITY so a company-wide ranking question is never
  // misrouted into a single-merchant search.
  const hasPluralMerchantWording = tokens.some((token) => stripArabicClitic(token) === norm("تجار"));
  if (hasPluralMerchantWording || includesAny(tokens, normalized, ACCOUNT_OVERVIEW_MARKERS)) {
    return { intent: "MERCHANT_ACCOUNTS_OVERVIEW", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null, productScope: null };
  }

  if (categories.has("MERCHANT_ACTIVITY")) {
    return { intent: "MERCHANT_ACTIVITY", entityKind: "MERCHANT", entityQuery, period, materialFilter, productScope: null };
  }
  if (categories.has("MERCHANT_ACCOUNT")) {
    return { intent: "MERCHANT_BALANCE", entityKind: "MERCHANT", entityQuery, period, materialFilter, productScope: null };
  }

  if (categories.has("INVENTORY") && includesAny(tokens, normalized, STOCK_LOCATION_MARKERS)) {
    return { intent: "STOCK_LOCATIONS", entityKind: "CATALOG", entityQuery, period, materialFilter, productScope };
  }

  if (categories.has("PRICE")) {
    return { intent: "PRODUCT_PRICE", entityKind: "CATALOG", entityQuery, period, materialFilter, productScope: null };
  }

  if (categories.has("SALES")) {
    // Checked unconditionally (not just when entityQuery is empty) — "اكثر
    // شي انباع" leaves "شي" behind as leftover text, which is never a real
    // entity name; a genuine top-selling question is always company-wide.
    if (includesAny(tokens, normalized, TOP_SELLING_MARKERS)) {
      return { intent: "TOP_SELLING", entityKind: "NONE", entityQuery: "", period, materialFilter, productScope: null };
    }
    if (entityQuery.length === 0) {
      return { intent: "SALES_SUMMARY", entityKind: "NONE", entityQuery: "", period, materialFilter, productScope: null };
    }
    // A named entity with no digit anchor could be a rep's own sales
    // ("مبيعات أحمد اليوم") just as easily as a product's ("مبيعات سامسونج") —
    // AMBIGUOUS_NAME tells entity-resolution.ts to try REP first, then
    // CATALOG, rather than guessing wrong here with no DB access.
    const entityKind: EntityKindHint = hasModelCodeAnchor(message) ? "CATALOG" : "AMBIGUOUS_NAME";
    return { intent: "PRODUCT_SALES", entityKind, entityQuery, period, materialFilter, productScope };
  }

  if (categories.has("PAYMENTS") && entityQuery.length === 0) {
    return { intent: "SALES_SUMMARY", entityKind: "NONE", entityQuery: "", period, materialFilter, productScope: null };
  }

  if (categories.has("INVENTORY") || categories.has("CATALOG")) {
    return { intent: "INVENTORY_SUMMARY", entityKind: "CATALOG", entityQuery, period, materialFilter, productScope };
  }

  return { intent: "GENERAL_HELP", entityKind: "NONE", entityQuery, period, materialFilter, productScope: null };
}

const REP_WORD_FORMS = ["مندوب", "مندوبين"].map(norm);

/** True when `token` is a genuine PREFIX (>= 2 chars, strictly shorter) of
 * a rep-related word — "مند" of "مندوب"/"مندوبين". Used only to offer
 * targeted suggestions for an incomplete message, never to silently guess
 * a full intent from a partial word. */
function isPrefixOfRepWord(token: string): boolean {
  if (token.length < 2) return false;
  return REP_WORD_FORMS.some((word) => word.length > token.length && word.startsWith(token));
}

/** Small, deterministic, non-DB "your question was too vague" query-rewrite
 * suggestions — built only from the raw leftover text the user actually
 * typed (never invented topics) or a small set of recognized PARTIAL-word
 * patterns (never a full report execution — see the module's own "دفعات
 * المند" requirement: a partial/incomplete message must offer helpful
 * SUGGESTIONS, not run an expensive company-wide query speculatively).
 * Returns an optional tailored `summary` alongside the suggestions — when a
 * specific partial pattern is recognized (e.g. "دفعات المند" clearly wants
 * SOME rep-payments period), the reply text itself says so instead of the
 * flat "حدد أكثر شو حاب تعرف." (still shown when nothing more specific was
 * recognized). `rawMessage` is the exact text the user sent, used only to
 * detect these partial patterns; `topic` is the router's own already-
 * cleaned leftover (see extractEntityQuery). Used by the engine when
 * routing lands on GENERAL_HELP (see runLocalOviTurn). */
export function buildGeneralHelpSuggestions(rawMessage: string, topic: string): { summary: string | null; suggestions: { label: string; message: string }[] } {
  const normalized = normalizeSearchText(rawMessage);
  const tokens = normalized.split(" ").filter(Boolean);

  const hasPaymentsWording = includesAny(tokens, normalized, PAYMENTS_WORDING);
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
  return {
    summary: null,
    suggestions: [
      { label: `مخزون جفرات ${trimmedTopic}`, message: `شو عنا جفرات ${trimmedTopic}؟` },
      { label: `النواقص من ${trimmedTopic}`, message: `شو قرب يخلص من ${trimmedTopic}؟` },
      { label: `الأكثر مبيعاً من ${trimmedTopic}`, message: `اكثر شي انباع من ${trimmedTopic}` },
    ],
  };
}
