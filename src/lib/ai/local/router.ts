/** Deterministic local query router — replaces the LLM entirely for "what is
 * the user asking, about what, for which period". Pure function, no DB, no
 * network — reuses classifyIntent (src/lib/ai/intent.ts) for coarse category
 * detection and layers a small, maintainable set of specific-intent/entity/
 * period/material-filter heuristics on top, exactly mirroring what the old
 * system prompt asked the model to infer by hand. Never exhaustive of every
 * possible Arabic phrasing (that would be an unmaintainable wall of
 * sentence-specific `if`s, which the spec explicitly forbids) — conservative
 * like classifyIntent itself: when unsure, prefer GENERAL_HELP (ask the user
 * to clarify, with real suggestions) over guessing wrong. */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";
import { classifyIntent, includesAny, CONVERSATIONAL_CLOSERS } from "@/lib/ai/intent";
import { extractAnchorTokens } from "@/lib/ai/fuzzy";
import type { OviAiContext } from "@/lib/ai/types";
import type { SalesPeriodInput } from "@/lib/ai/tools/sales";
import type { EntityKindHint, LocalQueryPlan } from "@/lib/ai/local/types";

const norm = (term: string) => normalizeSearchText(term);
const glossary = (key: keyof typeof DOMAIN_GLOSSARY): string[] => DOMAIN_GLOSSARY[key] ?? [];

/** Strips one leading Arabic clitic (definite article "ال"/"لل", or an
 * attached one-letter preposition/conjunction "ب"/"ل"/"و"/"ف"/"ك", including
 * the combined forms "بال"/"وال"/"فال"/"كال") — a small, deliberately
 * non-recursive heuristic (real morphology is out of scope), just enough to
 * make glossary/stopword matching and entity-name extraction work on the
 * attached forms Ovi staff actually type ("بالسيارات", "لمحمد", "الجلد").
 * Never applied to fuzzy-scoring itself (fuzzy.ts's own tokenScore already
 * tolerates minor variance) — only to routing/stopword decisions here. */
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
const NON_ENTITY_GLOSSARY_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["CASE_COVER", "WAREHOUSE", "MERCHANT", "PAYMENT", "DEBT", "SALE", "RETURN", "REP_CAR"];
const NON_ENTITY_GLOSSARY_TERMS = NON_ENTITY_GLOSSARY_GROUPS.flatMap((group) => glossary(group)).map(norm);
const MATERIAL_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["LEATHER", "CLEAR", "MAGSAFE", "RANGE", "ULTRA"];

/** Words that carry no entity-identifying meaning by themselves — question
 * words, pronouns referring back to context, period words (handled
 * separately by detectPeriod but still stripped here so they never dilute
 * an entity-name query), and generic colloquial/availability filler. */
const QUESTION_AND_PRONOUN_WORDS = ["شو", "كم", "مين", "من", "وين", "فين", "ايش", "أي", "اي", "هل", "متى", "منهم", "منه", "منها", "هذا", "هذه", "ذلك", "تلك", "هو", "هي", "هم", "كام"];
const PERIOD_WORDS = ["اليوم", "امبارح", "أمس", "امس", "الاسبوع", "هالاسبوع", "الأسبوع", "الشهر", "هالشهر"];
const ACTION_WORDS = ["معه", "عنده", "عندهم", "باع", "بعنا", "بعت", "دفع", "قبض", "سعر", "اسعار", "أسعار", "على", "عليه", "له", "آخر", "اخر", "قرب", "يخلص", "نواقص", "خلص"];
const ROUTER_FILLER_WORDS = ["طيب", "بس", "يعني", "لو", "ممكن", "فقط", "بدي", "أبغى", "اريد", "أريد", "في", "من", "عنا", "عندنا", "عندكم", "موجود", "متوفر", "فيه", "كمية", "كميات"];
const ROUTER_STOPWORDS = new Set([...QUESTION_AND_PRONOUN_WORDS, ...PERIOD_WORDS, ...ACTION_WORDS, ...ROUTER_FILLER_WORDS, ...NON_ENTITY_GLOSSARY_TERMS]);

/** Builds the likely entity-name/model-code leftover of a message: strips
 * every stopword/non-entity-glossary/period/action token (after clitic-
 * stripping each token so "بالسيارات"/"لمحمد" match their bare forms),
 * keeping short letter-only tokens ("a", "s") and material/variant words
 * ("ultra", "جلد") intact — both matter to downstream fuzzy scoring. Returns
 * "" when nothing meaningful is left — the caller reads that as "no new
 * entity mentioned, reuse conversation context". */
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

const LOW_STOCK_MARKERS = ["يخلص", "نواقص", "خلصت", "قارب", "قرب يخلص", "على وشك", "شارف"];
const TOP_SELLING_MARKERS = ["اكثر", "أكثر", "الاكثر", "الأكثر", "افضل مبيعا", "أفضل مبيعا", "top selling", "top"];
const REP_QUERY_MARKERS = ["مين معه", "مين عنده", "مين عندهم"];
const STOCK_LOCATION_MARKERS = ["وين", "فين"];

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
  if (tokens.includes(norm("امبارح")) || tokens.includes(norm("أمس")) || tokens.includes(norm("امس"))) return { type: "YESTERDAY" };
  if (tokens.includes(norm("اليوم"))) return { type: "TODAY" };
  return null;
}

/** The local router's single entry point — deterministic, synchronous, no
 * DB. See LocalQueryPlan's own doc comment for the exact decision fields. */
export function parseLocalQuery(message: string, context: OviAiContext): LocalQueryPlan {
  const normalized = normalizeSearchText(message);
  const tokens = normalized.split(" ").filter(Boolean);

  if (!normalized) {
    return { intent: "GENERAL_HELP", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null };
  }

  if (isWriteAttempt(tokens, normalized)) {
    return { intent: "READ_ONLY_REFUSAL", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null };
  }

  if (CONVERSATIONAL_CLOSERS.includes(normalized)) {
    return { intent: "CONVERSATIONAL", entityKind: "NONE", entityQuery: "", period: null, materialFilter: null };
  }

  const period = detectPeriod(tokens, normalized);
  const materialFilter = detectMaterialFilter(tokens);
  let entityQuery = extractEntityQuery(normalized);
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
  const hasReusableEntityInContext = Boolean(context.resolvedProductId || context.resolvedPhoneModelId);
  if (materialFilter && hasReusableEntityInContext && entityQuery.length > 0 && stripMaterialTokens(entityQuery).length === 0) {
    entityQuery = "";
  }

  const classification = classifyIntent(message, context);
  const categories = new Set(classification.categories);

  // LOW_STOCK — checked before generic INVENTORY: a company-wide question,
  // never entity-scoped, even if a stray product word appears alongside it.
  if (includesAny(tokens, normalized, LOW_STOCK_MARKERS)) {
    return { intent: "LOW_STOCK", entityKind: "NONE", entityQuery: "", period, materialFilter };
  }

  // REP_CAR wording ("سيارة"/"المندوب"...) — checked directly here (not
  // gated on categories.has("REP")): classifyIntent's own keyword matcher
  // requires an EXACT token match with no clitic stripping, so an attached
  // form like "بالسيارات" ("مين معه منهم بالسيارات؟") never sets its REP
  // category on its own — it only shows up there via a lucky context
  // fallback (or not at all, as a fresh/contextless message). This
  // router's own includesAny + glossary lookup already handles the
  // attached form correctly (glossary() terms are compared against
  // clitic-stripped tokens — see detectMaterialFilter for the same
  // pattern), so it's the authoritative check for this specific wording.
  // A model-code anchor present (or an explicit "مين معه" marker) means
  // the question is about a PRODUCT's spread across reps (REP_INVENTORY);
  // otherwise it's about one rep's own snapshot (REP_SUMMARY).
  const hasRepCarWording = tokens.some((token) => glossary("REP_CAR").map(norm).includes(stripArabicClitic(token)));
  if (hasRepCarWording) {
    if (hasModelCodeAnchor(message) || includesAny(tokens, normalized, REP_QUERY_MARKERS)) {
      return { intent: "REP_INVENTORY", entityKind: "CATALOG", entityQuery, period, materialFilter };
    }
    return { intent: "REP_SUMMARY", entityKind: "REP", entityQuery, period, materialFilter };
  }

  // A bare "مندوب"/"rep" word (no سيارة wording) — still a rep question.
  if (categories.has("REP")) {
    return { intent: "REP_SUMMARY", entityKind: "REP", entityQuery, period, materialFilter };
  }

  if (categories.has("MERCHANT_ACTIVITY")) {
    return { intent: "MERCHANT_ACTIVITY", entityKind: "MERCHANT", entityQuery, period, materialFilter };
  }
  if (categories.has("MERCHANT_ACCOUNT")) {
    return { intent: "MERCHANT_BALANCE", entityKind: "MERCHANT", entityQuery, period, materialFilter };
  }

  if (categories.has("INVENTORY") && includesAny(tokens, normalized, STOCK_LOCATION_MARKERS)) {
    return { intent: "STOCK_LOCATIONS", entityKind: "CATALOG", entityQuery, period, materialFilter };
  }

  if (categories.has("PRICE")) {
    return { intent: "PRODUCT_PRICE", entityKind: "CATALOG", entityQuery, period, materialFilter };
  }

  if (categories.has("SALES")) {
    // Checked unconditionally (not just when entityQuery is empty) — "اكثر
    // شي انباع" leaves "شي" behind as leftover text, which is never a real
    // entity name; a genuine top-selling question is always company-wide.
    if (includesAny(tokens, normalized, TOP_SELLING_MARKERS)) {
      return { intent: "TOP_SELLING", entityKind: "NONE", entityQuery: "", period, materialFilter };
    }
    if (entityQuery.length === 0) {
      return { intent: "SALES_SUMMARY", entityKind: "NONE", entityQuery: "", period, materialFilter };
    }
    // A named entity with no digit anchor could be a rep's own sales
    // ("مبيعات أحمد اليوم") just as easily as a product's ("مبيعات سامسونج") —
    // AMBIGUOUS_NAME tells entity-resolution.ts to try REP first, then
    // CATALOG, rather than guessing wrong here with no DB access.
    const entityKind: EntityKindHint = hasModelCodeAnchor(message) ? "CATALOG" : "AMBIGUOUS_NAME";
    return { intent: "PRODUCT_SALES", entityKind, entityQuery, period, materialFilter };
  }

  if (categories.has("PAYMENTS") && entityQuery.length === 0) {
    return { intent: "SALES_SUMMARY", entityKind: "NONE", entityQuery: "", period, materialFilter };
  }

  if (categories.has("INVENTORY") || categories.has("CATALOG")) {
    return { intent: "INVENTORY_SUMMARY", entityKind: "CATALOG", entityQuery, period, materialFilter };
  }

  return { intent: "GENERAL_HELP", entityKind: "NONE", entityQuery, period, materialFilter };
}

/** Small, deterministic, non-DB "your question was too vague" query-rewrite
 * suggestions — built only from the raw leftover text the user actually
 * typed (never invented topics). Used by the engine when routing lands on
 * GENERAL_HELP (see runLocalOviTurn). */
export function buildGeneralHelpSuggestions(rawTopic: string): { label: string; message: string }[] {
  const topic = rawTopic.trim();
  if (!topic) {
    return [
      { label: "شو قرب يخلص؟", message: "شو قرب يخلص بالمخزون؟" },
      { label: "مبيعات اليوم", message: "مبيعات اليوم" },
    ];
  }
  return [
    { label: `مخزون جفرات ${topic}`, message: `شو عنا جفرات ${topic}؟` },
    { label: `النواقص من ${topic}`, message: `شو قرب يخلص من ${topic}؟` },
    { label: `الأكثر مبيعاً من ${topic}`, message: `اكثر شي انباع من ${topic}` },
  ];
}
