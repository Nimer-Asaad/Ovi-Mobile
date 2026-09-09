/** Feature extraction — turns a raw message + conversation context into a
 * structured, deterministic feature set (section 31 of the spec). Pure, no
 * DB, no network. local/router.ts maps THESE features to a LocalIntent
 * (intent precedence, confidence, entity-kind collision handling); this
 * module only ever detects WHAT WAS SAID, never decides what to DO about
 * it. Reuses lexicon.ts (word groups), dialect.ts (clitic-stripping),
 * dates.ts (period phrases), fuzzy.ts (model-code anchor detection), and
 * local/product-scope.ts's own RequestedProductScope type — nothing here
 * duplicates any of those. */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";
import { includesAny } from "@/lib/ai/intent";
import { extractAnchorTokens } from "@/lib/ai/fuzzy";
import { stripArabicClitic, stripPossessiveSuffix, collapseExpressiveRepeats } from "@/lib/ai/language/dialect";
import { detectDatePeriod } from "@/lib/ai/language/dates";
import {
  matchesLexicalGroup,
  glossaryGroup,
  QUESTION_WHAT,
  QUESTION_HOW_MUCH,
  QUESTION_WHERE,
  QUESTION_WHO,
  QUESTION_WHEN,
  QUESTION_HOW,
  INVENTORY_WORDS,
  INVENTORY_NEGATIVE_WORDS,
  LOW_STOCK_WORDS,
  TOP_SELLING_WORDS,
  PRICE_WORDS,
  WHOLESALE_WORDS,
  RETAIL_WORDS,
  ACCOUNT_OVERVIEW_PHRASES,
  ACCOUNT_OVERVIEW_BARE_WORDS,
  RANKING_WORDS,
  REP_WORDS,
  REP_PLURAL_WORDS,
  LOCATION_WORDS,
  GLOBAL_WORDS,
  NEGATION_WORDS,
  RELATION_WORDS,
  CONTEXT_PRONOUNS,
  FILLER_WORDS,
  WRITE_ACTION_WORDS,
  QUANTITY_WORDS,
  MONEY_UNIT_WORDS,
  REP_COLLECTION_WORDS,
  MERCHANT_PAYMENT_WORDS,
} from "@/lib/ai/language/lexicon";
import type { OviAiContext } from "@/lib/ai/types";
import type { RequestedProductScope } from "@/lib/ai/local/product-scope";
import type { SalesPeriodInput } from "@/lib/ai/tools/sales";

const norm = (term: string) => normalizeSearchText(term);
const glossary = glossaryGroup;

/** Glossary groups (normalization.ts) that are pure CATEGORY/ACTION markers
 * — never part of a real product/model's own persisted name — safe to
 * strip out entirely when isolating an entity name. Deliberately EXCLUDES
 * the "variant/material" groups (ULTRA/RANGE/LEATHER/CLEAR/MAGSAFE/MATTE/
 * BOOK/SILICONE/HARD/PRIVACY/COLOR_MIXED): those words are often genuinely
 * part of a persisted name ("A26 Ultra", "Range 10") and matter to
 * scoreCandidateLabel's own ranking (fuzzy.ts) — stripping them
 * unconditionally would silently throw away real disambiguating signal. */
const NON_ENTITY_GLOSSARY_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["CASE_COVER", "SCREEN_PROTECTOR", "WAREHOUSE", "MERCHANT", "PAYMENT", "DEBT", "SALE", "RETURN", "REP_CAR"];
const NON_ENTITY_GLOSSARY_TERMS = NON_ENTITY_GLOSSARY_GROUPS.flatMap((group) => glossary(group)).map(norm);
/** Used to decide whether a token is "material-ish" for entity-preservation
 * purposes (never stripped from an entity query outright — see
 * stripMaterialTokens) — includes ULTRA/RANGE since those genuinely double
 * as persisted device-name components ("A26 Ultra"). */
export const MATERIAL_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["LEATHER", "CLEAR", "MATTE", "MAGSAFE", "RANGE", "ULTRA", "BOOK", "SILICONE", "HARD", "PRIVACY", "COLOR_MIXED"];
/** Used for the DISPLAYED materialFilter itself — deliberately EXCLUDES
 * ULTRA/RANGE: "s26 ultra شفاف" mentions "ultra" only as part of WHICH
 * device (a model-line qualifier), never as an accessory material/finish
 * the user wants to filter by, so it must never win over a genuine
 * material word like "شفاف" merely by appearing earlier in the sentence. */
const MATERIAL_FILTER_DISPLAY_GROUPS: (keyof typeof DOMAIN_GLOSSARY)[] = ["LEATHER", "CLEAR", "MATTE", "MAGSAFE", "BOOK", "SILICONE", "HARD", "PRIVACY", "COLOR_MIXED"];

const BARE_PREPOSITIONS = ["ل", "ب", "و", "ف", "ك", "عند"];
// "كان"/"كانت" (MSA copula "was/were" — "متى كانت آخر دفعة لمحمد؟") are
// listed explicitly (not left to clitic-stripping) — stripArabicClitic
// would otherwise treat "كانت"'s leading "ك" as the attached preposition
// "كـ" and mangle it into "انت" ("you"), corrupting the leftover text.
// "ماضي"/"فات"/"اول"/"أول"/"اللي" are remnants of a multi-word period
// phrase dates.ts already recognizes as a whole ("الأسبوع الماضي", "اول
// مبارح") — stripped individually too so they never linger as fake entity
// text once the phrase itself has already been used to resolve a period.
// "مرة" ("time/once", as in "آخر مرة" = "last time") is a generic Arabic
// word carrying no entity-identifying meaning on its own — left unstripped
// it pollutes a merchant/rep search's whole-phrase `contains` query (search
// tools build their DB filter from buildSearchVariants' WHOLE leftover
// string, not per-token anchors, unlike catalog search) and can fail to
// find a real row purely because of this one extra trailing word.
// "قبل" ("before", as in "قبل مبارح" = "day before yesterday") is a
// relational/temporal filler with no entity-identifying meaning of its own
// — left unstripped it leaks into the entity query exactly like "مرة" did
// (found the same way: a date-period phrase's leftover word polluting a
// company-wide, entity-free question into looking like it named someone).
// "هذا"/"هذه" (MSA demonstrative "this") — found leaking into the entity
// query for "ما إجمالي مبيعات هذا الشهر؟", turning what should be a clean
// company-wide SALES_SUMMARY into an AMBIGUOUS_NAME sales question about a
// nonexistent entity called "هذا".
const MISC_STOPWORDS = [
  "آخر", "اخر", "على", "عليه", "له", "بس", "طب", "في", "من", "كان", "كانت", "ماضي", "فات", "اول", "أول", "اللي", "مرة",
  "مره", "قبل", "هذا", "هذه",
  // Generic MSA "value/amount" filler ("ما قيمة المبالغ المحصلة أمس؟") —
  // carries no entity-identifying meaning of its own, same role as
  // "اجمالي"/"إجمالي" (GLOBAL_WORDS/QUANTITY_WORDS).
  "قيمة", "مبالغ", "صافي",
  // "بلغت"/"بلغ" ("amounted to" — MSA "كم بلغت مبيعات الأسبوع الماضي؟") —
  // same generic quantity-filler role, carries no entity meaning.
  "بلغت", "بلغ",
  // MSA pronouns "هو"/"هي" ("ما هو إجمالي الديون...؟") — purely
  // grammatical, never entity-identifying.
  "هو", "هي",
  // "بالتفصيل"/"تفصيل" ("in detail" — "مبيعات اليوم بالتفصيل") — generic
  // business filler, never entity-identifying.
  "بالتفصيل", "تفصيل",
  // "وكم" ("and how much") — a conjunction "و" fused onto the 2-letter
  // word "كم" sits right at stripArabicClitic's own length guard boundary
  // (guard requires length > 3; "وكم" is exactly 3) and so is deliberately
  // never auto-stripped there (protecting other genuine 3-letter words
  // starting with the same 5 clitic letters, e.g. "ولد"/"وقف"). Listed
  // here instead as its own literal stopword — found leaking into a
  // conversational follow-up's entity query ("وكم باع هالشهر؟" after a rep
  // was already resolved in context).
  "وكم",
];

/** Every token that carries no entity-identifying meaning by itself —
 * question words, relation/context-pronoun words, filler, negation, global/
 * ranking/quantity words, bare single-letter prepositions, every action-
 * word lexical group (inventory/low-stock/top-selling/price/wholesale/
 * retail/location — "عنا"/"موجود"/"سعر"/"وين" etc. are category/action
 * markers, never part of a persisted entity's own name), and every
 * NON_ENTITY glossary term — combined once at module load. Multi-word
 * phrases in these groups never match a single stripped token, so
 * including them here is harmless (they simply never hit). */
const ENTITY_QUERY_STOPWORDS = new Set(
  [
    ...QUESTION_WHAT, ...QUESTION_HOW_MUCH, ...QUESTION_WHERE, ...QUESTION_WHO, ...QUESTION_WHEN, ...QUESTION_HOW,
    ...RELATION_WORDS, ...CONTEXT_PRONOUNS, ...FILLER_WORDS, ...NEGATION_WORDS, ...GLOBAL_WORDS, ...RANKING_WORDS,
    ...QUANTITY_WORDS, ...BARE_PREPOSITIONS, ...MISC_STOPWORDS, ...NON_ENTITY_GLOSSARY_TERMS,
    ...INVENTORY_WORDS, ...INVENTORY_NEGATIVE_WORDS, ...LOW_STOCK_WORDS, ...TOP_SELLING_WORDS, ...PRICE_WORDS,
    ...WHOLESALE_WORDS, ...RETAIL_WORDS, ...LOCATION_WORDS, ...ACCOUNT_OVERVIEW_PHRASES, ...ACCOUNT_OVERVIEW_BARE_WORDS,
    ...REP_WORDS, ...MONEY_UNIT_WORDS,
  ].map(norm),
);

/** Single-word period tokens worth stripping from an entity query — the
 * multi-word phrases dates.ts also recognizes ("الاسبوع الماضي") don't need
 * per-token stripping here since their OWN words ("الاسبوع"/"الماضي") are
 * either already covered above or too generic to bother with; this list is
 * only the common single-token forms staff actually type inline. */
const PERIOD_STOPWORD_TOKENS = [
  "اليوم", "هاليوم", "مبارح", "امبارح", "أمس", "امس", "الاسبوع", "هالاسبوع", "الأسبوع", "هالأسبوع", "الشهر", "هالشهر",
  "يومين", "ايام", "أيام",
  // Word-number forms of a "آخر N يوم/أيام" phrase (dates.ts's own
  // detectRecentNDays word-number map) — the digit form ("آخر 3 أيام") is
  // already stripped as a unit by extractEntityQuery's own regex below;
  // these cover the SAME phrase spelled with a word instead ("آخر سبع
  // أيام"), so its leftover count word never survives into the entity
  // query either.
  "ثلاث", "اربع", "أربع", "خمس", "ست", "ستة", "سبع", "سبعة",
].map(norm);

function isMaterialToken(token: string): boolean {
  const clean = stripArabicClitic(token);
  return MATERIAL_GROUPS.some((group) => glossary(group).map(norm).includes(clean));
}

function stripMaterialTokens(entityQuery: string): string {
  return entityQuery.split(" ").filter(Boolean).filter((token) => !isMaterialToken(token)).join(" ").trim();
}

function isStopwordToken(token: string): boolean {
  if (ENTITY_QUERY_STOPWORDS.has(token) || PERIOD_STOPWORD_TOKENS.includes(token)) return true;
  // A possessive-suffixed category/action word ("مبيعاتنا" = "مبيعات"+
  // "نا", "دفعاتهم" = "دفعات"+"هم") is just as much a pure category/action
  // marker as its bare form — checked here too (not just the CASE_COVER/
  // SCREEN_PROTECTOR-specific stem check below), the same
  // stripPossessiveSuffix fallback matchesLexicalGroup (lexicon.ts) uses,
  // so it's consistently stripped from the entity query rather than
  // surviving as fake leftover "entity" text. Found via corpus testing:
  // "شو مبيعاتنا اليوم؟" was leaving "مبيعاتنا" behind as if it named a
  // real entity, turning a clean company-wide SALES_SUMMARY into an
  // AMBIGUOUS_NAME sales question.
  if (stripPossessiveSuffix(token).some((stem) => ENTITY_QUERY_STOPWORDS.has(stem))) return true;
  // "جفراته"/"كفراته" (possessive-suffix CASE_COVER/SCREEN_PROTECTOR forms —
  // see detectRequestedProductScope's own doc comment) are pure category
  // markers just like their bare forms, never part of an entity's own name.
  // Checked against the RAW token first — "كفر" itself starts with "ك",
  // one of the single-letter clitic prefixes, so clitic-stripping FIRST
  // would corrupt "كفراته" into "فراته" before the stem check ever runs.
  return hasCaseCoverOrScreenProtectorStem(token);
}

function hasCaseCoverOrScreenProtectorStem(token: string): boolean {
  if (CASE_COVER_SUFFIX_STEMS.some((stem) => token.startsWith(stem)) || SCREEN_PROTECTOR_SUFFIX_STEMS.some((stem) => token.startsWith(stem))) return true;
  const stripped = stripArabicClitic(token);
  return CASE_COVER_SUFFIX_STEMS.some((stem) => stripped.startsWith(stem)) || SCREEN_PROTECTOR_SUFFIX_STEMS.some((stem) => stripped.startsWith(stem));
}

/** Builds the likely entity-name/model-code leftover of a message: strips
 * every stopword/period/non-entity-glossary token, keeping short letter-
 * only tokens ("a", "s") and material/variant words ("ultra", "جلد")
 * intact — both matter to downstream fuzzy scoring. Returns "" when nothing
 * meaningful is left.
 *
 * The RAW token is checked against the stopword set FIRST, before any
 * clitic-stripping is attempted — a whole real lexicon word that happens
 * to start with a clitic-shaped letter ("لزقات", the screen-protector word
 * itself, starts with "ل") must never be corrupted into "زقات" by
 * over-eagerly assuming that "ل" is the attached preposition. Only a
 * SURVIVING token (not itself a recognized stopword) gets clitic-stripped,
 * for the genuine attached-form case ("لمحمد" -> "محمد", where the raw
 * form matches nothing on its own). */
interface EntityQueryResult {
  entityQuery: string;
  /** True when the leftover text is ONLY there because a car-compound
   * PRODUCT name ("شاحن سيارة") was deliberately preserved — never a real
   * person's name. Used by router.ts to keep such a leftover from being
   * mistaken for a merchant/rep name by the PAYMENTS-category branch
   * ("دفعة شاحن سيارة" must clarify, never blindly guess a nonexistent
   * merchant called "شاحن سيارة" — see that branch's own doc comment). */
  isCarCompoundProductOnly: boolean;
}

function extractEntityQuery(normalizedMessage: string): EntityQueryResult {
  // Strip a whole "N يوم/أيام/ايام" day-COUNT phrase as one unit first —
  // its digit is a period count already consumed by dates.ts's own
  // detectRecentNDays, never a product/model code, so a bare "3" must
  // never survive alone and get mistaken for leftover entity text ("آخر 3
  // أيام" must leave nothing behind). Per-token stopword filtering below
  // can't catch this on its own since it only ever removes/keeps whole
  // tokens, never rewrites a digit+word pair together.
  const withoutDayCount = normalizedMessage.replace(/\d+\s+(?:يوم|ايام|أيام)/gu, " ");
  const rawTokens = withoutDayCount.split(" ").filter(Boolean);
  const carWords = new Set([norm("سيارة"), norm("سيارات")]);

  // First pass: find every "[preceder] سيارة" compound PAIR — BOTH indices
  // (the preceder word itself, e.g. "شاحن", AND the "سيارة" word) belong
  // to the compound, never to a separately-tracked "real name" signal.
  const carCompoundIndices = new Set<number>();
  rawTokens.forEach((token, index) => {
    if (carWords.has(stripArabicClitic(token)) && CAR_COMPOUND_PRODUCT_PRECEDERS.includes(stripArabicClitic(rawTokens[index - 1] ?? ""))) {
      carCompoundIndices.add(index);
      carCompoundIndices.add(index - 1);
    }
  });

  let hasOtherToken = false;
  const kept = rawTokens
    .filter((token, index) => {
      // "شاحن سيارة"/"كفر سيارة" — a compound catalog PRODUCT name where
      // "سيارة" identifies WHICH accessory, never a rep's own vehicle here
      // (see hasGenuineRepCarSignal's own doc comment for the matching
      // action-feature guard) — kept in the entity query instead of
      // stripped as a pure REP_CAR category word, the same way "جفر"/
      // "شفاف" survive when they're genuinely part of what's being asked
      // about.
      if (carCompoundIndices.has(index)) return true;
      if (isStopwordToken(token)) return false;
      const survives = !isStopwordToken(stripArabicClitic(token));
      if (survives) hasOtherToken = true;
      return survives;
    })
    .map((token) => stripArabicClitic(token));
  return { entityQuery: kept.join(" ").trim(), isCarCompoundProductOnly: carCompoundIndices.size > 0 && !hasOtherToken };
}

function detectMaterialFilter(tokens: string[]): string | null {
  for (const token of tokens) {
    const clean = stripArabicClitic(token);
    for (const group of MATERIAL_FILTER_DISPLAY_GROUPS) {
      const terms = glossary(group).map(norm);
      if (terms.includes(clean)) return glossary(group)[0] ?? null;
    }
  }
  return null;
}

/** Short bare stems whose possessive-SUFFIX forms ("جفراته" = "his cases",
 * "كفراته") are common Ovi shorthand (section 5) but aren't caught by
 * stripArabicClitic (prefix-only — a full suffix-aware analyzer is out of
 * scope, see language/dialect.ts's own doc comment on staying narrow). A
 * plain `token.startsWith(stem)` catches these specific short, high-
 * frequency stems without a general morphology engine. */
const CASE_COVER_SUFFIX_STEMS = ["جفر", "كفر", "جراب"];
const SCREEN_PROTECTOR_SUFFIX_STEMS = ["لزق", "قزاز"];

function detectRequestedProductScope(tokens: string[], normalized: string): RequestedProductScope | null {
  if (matchesLexicalGroup(tokens, normalized, glossary("CASE_COVER"))) return "CASE_COVER";
  if (matchesLexicalGroup(tokens, normalized, glossary("SCREEN_PROTECTOR"))) return "SCREEN_PROTECTOR";
  // Raw token checked BEFORE clitic-stripping — "كفر" itself starts with
  // "ك" (a single-letter clitic prefix), so stripping first would corrupt
  // "كفراته" into "فراته" before the stem check ever sees it.
  if (tokens.some((token) => CASE_COVER_SUFFIX_STEMS.some((stem) => token.startsWith(stem) || stripArabicClitic(token).startsWith(stem)))) return "CASE_COVER";
  if (tokens.some((token) => SCREEN_PROTECTOR_SUFFIX_STEMS.some((stem) => token.startsWith(stem) || stripArabicClitic(token).startsWith(stem)))) return "SCREEN_PROTECTOR";
  return null;
}

/** A real, persisted-model-code-like anchor is present (a digit-bearing
 * token, or a short-letter-token immediately followed by one) — the same
 * signal extractAnchorTokens (fuzzy.ts) uses to prefer a bounded DB anchor
 * fetch. */
function hasModelCodeAnchor(rawMessage: string): boolean {
  return extractAnchorTokens(rawMessage).some((anchor) => /\d/.test(anchor));
}

export interface QuestionFeatures {
  what: boolean;
  howMuch: boolean;
  where: boolean;
  who: boolean;
  when: boolean;
  how: boolean;
}

export interface ActionFeatures {
  inventory: boolean;
  inventoryNegative: boolean;
  lowStock: boolean;
  sales: boolean;
  topSelling: boolean;
  price: boolean;
  wholesale: boolean;
  retail: boolean;
  merchantAccountOverviewPhrase: boolean;
  merchantAccountBareWord: boolean;
  merchantActivity: boolean;
  merchantAccount: boolean;
  repPayments: boolean;
  /** Any PAYMENT-glossary word at all, regardless of plurality or whether a
   * specific merchant name is also present — router.ts combines this with
   * "مين"/ranking wording + an EMPTY entityQuery to catch "مين قبض اكتر
   * هالشهر؟" (a company-wide "who collected most" ranking question with no
   * explicit "مندوبين"/"الشباب" plural word), without ever letting a
   * message that also names a specific merchant ("آخر قبض من محمد") be
   * misread as a rep-payments question. */
  hasPaymentWording: boolean;
  /** "قبض"/"تحصيل"/"استلم" family — a rep COLLECTS, a merchant never does.
   * Used by router.ts to prefer a rep's own collected-payments summary over
   * a merchant-activity lookup when a named payment question uses this
   * specific direction of wording (see REP_THEN_MERCHANT, local/types.ts). */
  hasCollectionWording: boolean;
  /** "دفع"/"سدد"/"دفعة" family — a merchant PAYS Ovi; the mirror signal of
   * hasCollectionWording, used the same way in the opposite direction. */
  hasMerchantPaymentWording: boolean;
  repCar: boolean;
  rep: boolean;
  repPlural: boolean;
  stockLocation: boolean;
  write: boolean;
}

export type ParserConfidence = "HIGH" | "MEDIUM" | "LOW";

/** The complete, structured result of parsing one message — see the
 * module's own doc comment. `confidence` reflects how much of this is
 * grounded: HIGH = a clear action word + a resolvable entity query (or no
 * entity needed at all); MEDIUM = a clear action word but a weak/empty
 * entity query where one is normally expected; LOW = no clear action
 * feature fired at all. local/router.ts uses this to decide whether it's
 * safe to run a factual tool or safer to offer suggestions instead (section
 * 32 — LOW must never execute a risky factual lookup). */
export interface QueryFeatures {
  rawMessage: string;
  normalizedText: string;
  tokens: string[];
  questionFeatures: QuestionFeatures;
  actionFeatures: ActionFeatures;
  productScope: RequestedProductScope | null;
  materialFilter: string | null;
  datePeriod: SalesPeriodInput | null;
  entityQuery: string;
  hasModelCodeAnchor: boolean;
  relation: boolean;
  ranking: boolean;
  globalScope: boolean;
  negativeQuestion: boolean;
  /** True when `entityQuery` is non-empty ONLY because a car-compound
   * PRODUCT name ("شاحن سيارة") was preserved — never a real person's
   * name. router.ts uses this to keep such a leftover from being mistaken
   * for a merchant/rep name by the PAYMENTS-category branch. */
  isCarCompoundProductOnly: boolean;
  confidence: ParserConfidence;
}

function computeQuestionFeatures(tokens: string[], normalized: string): QuestionFeatures {
  return {
    what: matchesLexicalGroup(tokens, normalized, QUESTION_WHAT),
    howMuch: matchesLexicalGroup(tokens, normalized, QUESTION_HOW_MUCH),
    where: matchesLexicalGroup(tokens, normalized, QUESTION_WHERE),
    who: matchesLexicalGroup(tokens, normalized, QUESTION_WHO),
    when: matchesLexicalGroup(tokens, normalized, QUESTION_WHEN),
    how: matchesLexicalGroup(tokens, normalized, QUESTION_HOW),
  };
}

// "شاحن سيارة"/"حامل سيارة"/"كفر سيارة" ("car charger"/"car holder"/"car
// case" — real catalog PRODUCT compound names, "سيارة" here describing
// WHAT KIND of accessory, never a rep's own vehicle) must never force
// REP_CAR just because the bare word "سيارة" is present — found via this
// round's own product-vs-rep-collision testing. Only "سيارة"/"سيارات"
// carry this specific risk (a genuine catalog compound-noun pattern);
// every OTHER REP_CAR word ("مندوب", "عربة", "محمل", …) has no such
// collision and still counts unconditionally.
const CAR_COMPOUND_PRODUCT_PRECEDERS = ["شاحن", "حامل", "كفر", "كفره", "جفر", "جفره", "جراب", "غطاء", "غطا"];

function hasGenuineRepCarSignal(tokens: string[], normalized: string): boolean {
  const nonCarRepCarTerms = glossary("REP_CAR").filter((term) => norm(term) !== norm("سيارة") && norm(term) !== norm("سيارات"));
  if (matchesLexicalGroup(tokens, normalized, nonCarRepCarTerms)) return true;

  const carWords = new Set([norm("سيارة"), norm("سيارات")]);
  // Matches a possessive-suffixed form too ("سيارته"/"بسيارته") — not just
  // the bare/clitic-stripped form — the same suffix-awareness
  // matchesLexicalGroup already gives every OTHER REP_CAR term; losing it
  // here specifically (found via this round's own regression testing)
  // would silently break "وين سيارته؟"/"مين حامل A26 بسيارته؟".
  const isCarToken = (token: string) => {
    const declitic = stripArabicClitic(token);
    if (carWords.has(declitic)) return true;
    return stripPossessiveSuffix(token).some((stem) => carWords.has(stem)) || stripPossessiveSuffix(declitic).some((stem) => carWords.has(stem));
  };
  return tokens.some((token, index) => {
    if (!isCarToken(token)) return false;
    const previous = tokens[index - 1];
    if (!previous) return true;
    return !CAR_COMPOUND_PRODUCT_PRECEDERS.includes(stripArabicClitic(previous));
  });
}

function computeActionFeatures(tokens: string[], normalized: string): ActionFeatures {
  const repPlural = tokens.some((token) => REP_PLURAL_WORDS.map(norm).includes(stripArabicClitic(token)));
  const hasPaymentWording = matchesLexicalGroup(tokens, normalized, glossary("PAYMENT"));
  return {
    inventory: matchesLexicalGroup(tokens, normalized, INVENTORY_WORDS),
    // Clitic-aware (matchesLexicalGroup) below, not plain includesAny —
    // found this round via corpus testing: "بالمفرق" ("بال"+"مفرق")/
    // "المنتجات الناقصة" ("الناقصة") never registered against their own
    // bare RETAIL_WORDS/LOW_STOCK_WORDS entries under plain includesAny,
    // the same class of bug fixed for `ranking`/`topSelling` above.
    inventoryNegative: matchesLexicalGroup(tokens, normalized, INVENTORY_NEGATIVE_WORDS),
    lowStock: matchesLexicalGroup(tokens, normalized, LOW_STOCK_WORDS),
    sales: matchesLexicalGroup(tokens, normalized, glossary("SALE")),
    topSelling: matchesLexicalGroup(tokens, normalized, TOP_SELLING_WORDS),
    price: matchesLexicalGroup(tokens, normalized, PRICE_WORDS),
    wholesale: matchesLexicalGroup(tokens, normalized, WHOLESALE_WORDS),
    retail: matchesLexicalGroup(tokens, normalized, RETAIL_WORDS),
    merchantAccountOverviewPhrase: includesAny(tokens, normalized, ACCOUNT_OVERVIEW_PHRASES),
    merchantAccountBareWord: tokens.some((token) => ACCOUNT_OVERVIEW_BARE_WORDS.map(norm).includes(stripArabicClitic(token))),
    merchantActivity: false, // decided in router.ts via classifyIntent's own "آخر"-override semantics (unchanged, already correct)
    merchantAccount: matchesLexicalGroup(tokens, normalized, glossary("DEBT")),
    repPayments: repPlural && hasPaymentWording,
    hasPaymentWording,
    hasCollectionWording: matchesLexicalGroup(tokens, normalized, REP_COLLECTION_WORDS),
    hasMerchantPaymentWording: matchesLexicalGroup(tokens, normalized, MERCHANT_PAYMENT_WORDS),
    repCar: hasGenuineRepCarSignal(tokens, normalized),
    rep: matchesLexicalGroup(tokens, normalized, REP_WORDS),
    repPlural,
    stockLocation: matchesLexicalGroup(tokens, normalized, LOCATION_WORDS),
    write: includesAny(tokens, normalized, WRITE_ACTION_WORDS),
  };
}

/** Deterministic HIGH/MEDIUM/LOW confidence — see QueryFeatures' own doc
 * comment. A company-wide/no-entity action (low stock, top-selling, global
 * case count, merchant overview, rep payments...) is always HIGH once its
 * own action feature fired, since it genuinely needs no entity at all. */
function computeConfidence(hasAnyAction: boolean, entityNeeded: boolean, entityQuery: string): ParserConfidence {
  if (!hasAnyAction) return "LOW";
  if (!entityNeeded) return "HIGH";
  return entityQuery.trim().length > 0 ? "HIGH" : "MEDIUM";
}

/** The feature extractor's single entry point — deterministic, synchronous,
 * no DB. `entityNeeded` is a caller-supplied hint (the caller usually
 * already knows, from the action features, whether this question is
 * entity-scoped) used only for confidence scoring — see computeConfidence. */
export function extractQueryFeatures(rawMessage: string, context: OviAiContext, entityNeeded = true): QueryFeatures {
  // Expressive-repeat collapsing ("كمييييه" -> "كمية", "قدييش" -> "قديش")
  // applied up front, on top of normalizeSearchText's own lossless
  // normalization — a narrow, safe fold (see dialect.ts's own doc comment:
  // real Arabic/English business words essentially never repeat the same
  // letter 3+ times), applied here (not just inside fuzzy scoring) so
  // EVERY lexicon/stopword lookup below also benefits from it.
  const normalizedText = collapseExpressiveRepeats(norm(rawMessage));
  const tokens = normalizedText.split(" ").filter(Boolean);

  const questionFeatures = computeQuestionFeatures(tokens, normalizedText);
  const actionFeatures = computeActionFeatures(tokens, normalizedText);

  const datePeriod = detectDatePeriod(rawMessage);
  const materialFilter = detectMaterialFilter(tokens);
  const entityQueryResult = extractEntityQuery(normalizedText);
  let entityQuery = entityQueryResult.entityQuery;
  const isCarCompoundProductOnly = entityQueryResult.isCarCompoundProductOnly;

  const hasReusableEntityInContext = Boolean(context.resolvedProductId || context.resolvedPhoneModelId);
  if (materialFilter && hasReusableEntityInContext && entityQuery.length > 0 && stripMaterialTokens(entityQuery).length === 0) {
    entityQuery = "";
  }

  const requestedScope = detectRequestedProductScope(tokens, normalizedText);
  const isFollowUpMessage = entityQuery.length === 0;
  const productScope: RequestedProductScope | null = requestedScope ?? (isFollowUpMessage ? (context.productScope ?? null) : null);

  const negativeQuestion = includesAny(tokens, normalizedText, NEGATION_WORDS) || actionFeatures.inventoryNegative;
  const relation = matchesLexicalGroup(tokens, normalizedText, RELATION_WORDS);
  // Clitic-aware (matchesLexicalGroup, not plain includesAny) — "الأكتر"/
  // "الاكثر" ("the most") are extremely common WITH the definite article,
  // and only the bare "اكثر"/"اكتر" forms are stored (never one entry per
  // ال-prefixed variant — same bare-storage convention as every other
  // lexicon group). Found missing this round: a plain includesAny here
  // meant "شو الاكتر مبيعا A26" never registered as a ranking question at
  // all despite "اكتر" being a listed RANKING_WORDS term.
  const ranking = matchesLexicalGroup(tokens, normalizedText, RANKING_WORDS);
  const globalScope = matchesLexicalGroup(tokens, normalizedText, GLOBAL_WORDS);

  const hasAnyAction = Object.values(actionFeatures).some(Boolean) || questionFeatures.where || datePeriod !== null;
  const confidence = computeConfidence(hasAnyAction, entityNeeded, entityQuery);

  return {
    rawMessage,
    normalizedText,
    tokens,
    questionFeatures,
    actionFeatures,
    productScope,
    materialFilter,
    datePeriod,
    entityQuery,
    hasModelCodeAnchor: hasModelCodeAnchor(rawMessage),
    relation,
    ranking,
    globalScope,
    negativeQuestion,
    isCarCompoundProductOnly,
    confidence,
  };
}
