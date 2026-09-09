/** Centralized Palestinian-Arabic (+ MSA, + mixed English) language lexicon
 * for the local Ovi AI engine — every reusable word/phrase GROUP lives here,
 * never scattered across router.ts/engine.ts/tools. Concepts that are ALSO
 * real product-name/category vocabulary (case/cover, screen protector,
 * material/color, merchant, payment, debt, sale, rep-car) stay in
 * DOMAIN_GLOSSARY (normalization.ts) — reused here, not duplicated — since
 * fuzzy.ts's own SYNONYM_GROUPS and local/product-scope.ts's classifier
 * both need those same groups. This file holds the groups that are PURELY
 * intent/question/relation signals and never part of a persisted entity's
 * own name: question words, ranking/comparison words, quantity-question
 * words, low-stock/top-selling/price/wholesale/retail/merchant-overview/
 * location/global/negation/write-action/filler/relation-pronoun phrases. */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";
import { includesAny } from "@/lib/ai/intent";
import { stripArabicClitic, stripPossessiveSuffix } from "@/lib/ai/language/dialect";

const norm = (term: string) => normalizeSearchText(term);

/** Reads a DOMAIN_GLOSSARY group safely under `noUncheckedIndexedAccess`. */
export function glossaryGroup(key: keyof typeof DOMAIN_GLOSSARY): string[] {
  return DOMAIN_GLOSSARY[key] ?? [];
}

/** Word-boundary-aware, CLITIC-AWARE, SUFFIX-AWARE lexical-group matching —
 * the authoritative "does this message mention concept X" check across the
 * whole local engine. Stronger than plain includesAny (intent.ts) for the
 * single-word terms most of this domain's lexicon is made of: it also
 * recognizes an attached leading clitic ("بالسيارات", "المندوبين",
 * "للتاجر") and a trailing possessive suffix ("جفراته", "مبيعاته",
 * "سيارته" — see stripPossessiveSuffix's own doc comment), separately and
 * combined ("بسيارته"), by stripping each token before comparing — always
 * trying the RAW token first, so a genuine glossary/lexicon word is never
 * mangled before being checked as itself. Falls back to includesAny for any
 * remaining multi-word term ("حماية شاشة") — single-token stripping doesn't
 * apply to a phrase spanning several words. */
export function matchesLexicalGroup(tokens: string[], normalized: string, terms: string[]): boolean {
  const normalizedTerms = terms.map(norm);
  const matchesToken = (candidate: string) => normalizedTerms.includes(candidate);
  for (const token of tokens) {
    if (matchesToken(token)) return true;
    const declitic = stripArabicClitic(token);
    if (matchesToken(declitic)) return true;
    if (stripPossessiveSuffix(token).some(matchesToken)) return true;
    if (stripPossessiveSuffix(declitic).some(matchesToken)) return true;
  }
  return includesAny(tokens, normalized, terms);
}

/** True when `token` is a genuine PREFIX (>= 2 chars, strictly shorter) of
 * one of `words` — "مند" of "مندوب"/"مندوبين". Used only to offer targeted
 * suggestions for an incomplete message (see router.ts's partial-intent
 * handling and local/autocomplete.ts), never to silently guess a full
 * intent from a partial word. */
export function isPrefixOfAny(token: string, words: string[]): boolean {
  if (token.length < 2) return false;
  const normalizedWords = words.map(norm);
  return normalizedWords.some((word) => word.length > token.length && word.startsWith(token));
}

// ---------------------------------------------------------------------------
// Question words (section 2) — FEATURES, never intents on their own.
// ---------------------------------------------------------------------------
export const QUESTION_WHAT = ["شو", "اشو", "ايش", "إيش", "اش", "وش", "ماذا", "ما"];
export const QUESTION_HOW_MUCH = ["قديش", "كديش", "كدي", "كم", "كام", "ما مقدار", "ما كمية"];
export const QUESTION_WHERE = ["وين", "اين", "أين", "باي محل", "بأي محل", "باي مكان", "بأي مكان", "وينه", "وينهم"];
export const QUESTION_WHO = ["مين", "من", "عند مين", "مع مين"];
export const QUESTION_WHEN = ["متى", "امتى", "إمتى", "اي ساعة", "أي ساعة", "اي تاريخ", "أي تاريخ"];
export const QUESTION_HOW = ["كيف", "شو وضع", "شو وضعه", "شو وضعهم"];

// ---------------------------------------------------------------------------
// Inventory / low-stock (sections 3-4)
// ---------------------------------------------------------------------------
/** Broad "is there any / how much is left" availability wording — includes
 * classic MSA (متوفر) and heavy Palestinian colloquial (ضايل/ضل/باقي/لسا
 * في). Deliberately does NOT include bare "عنا"/"موجود" here (those live in
 * language's FILLER_WORDS since they're stripped as generic availability
 * chatter when isolating an entity name — see features.ts) — this group is
 * for CLASSIFYING the message as an inventory question in the first place. */
export const INVENTORY_WORDS = [
  "عنا", "عندنا", "موجود", "موجودات", "متوفر", "متوفره", "متوفرة", "ضايل", "ضال", "ضل", "ضلنا", "ضله", "ضلت", "ضلوا", "ظل",
  "باقي", "باقي منه", "باقي منها", "شو فيه", "شو في", "شو موجود", "شو عنا", "قديش عنا", "قديش في", "كم عنا", "كم موجود",
  "كم ضايل", "كم باقي", "كم الكمية", "شو الكمية", "المخزون", "مخزون", "المستودع", "المخزن", "البضاعة", "ستوك", "stock",
  "في عنا", "في منه", "في منها", "لسا في", "لسه في", "بعد في", "لسا موجود", "لسه موجود", "بعده موجود", "بعدها موجود",
  // MSA existence phrasing ("أين يوجد A26؟", "ما المتوفر من A26") — section
  // 39's formal-Arabic requirement.
  "يوجد", "توجد", "المتوفر", "المتاحة", "متاح", "متاحة",
];
/** Depletion/negative-inventory wording — "ما فيش A26؟" is a QUESTION about
 * live stock, never a statement to answer from language alone (section 3's
 * explicit "IMPORTANT" note) — still routes to a live inventory lookup.
 * "فش"/"فش منه"/"فش منها"/"فيش عنا" (a further colloquial contraction of
 * "مافيش"), "ضلش"/"ضالش" (negated "didn't remain" — NOT the same as the
 * positive "ضل"/"ضال" in INVENTORY_WORDS above), "خلصان"/"مخلص", "مفقود",
 * and "متوفرش" (negated MSA "متوفر") added for the Palestinian-dialect
 * upgrade. */
export const INVENTORY_NEGATIVE_WORDS = [
  "ما في", "مافي", "ما فيش", "مافيش", "فيش", "فش", "فش منه", "فش منها", "فيش عنا", "مش موجود", "خلص", "خلصت", "خلصان",
  "مخلص", "نفد", "نفدت", "نفذت", "مقطوع", "انقطع", "ضلش", "ضالش", "مفقود", "متوفرش",
];
export const LOW_STOCK_WORDS = [
  "شو قرب يخلص", "شو قرب يقطع", "شو ناقص", "شو النواقص", "النواقص", "الاصناف الناقصة", "الأصناف الناقصة", "شو قليل",
  "شو كميته قليلة", "قرب يخلص", "يخلص", "نواقص", "خلصت", "قارب", "قرب يقطع", "على وشك النفاد", "على وشك", "منخفض المخزون",
  "منخفضة المخزون", "أصناف منخفضة", "اصناف منخفضة", "منخفضة", "low stock", "شو لازم نطلب", "شو بدنا نزود", "شو ناقصنا",
  // "what's left" wording ("شو ضل؟", "شو فاضل؟") — colloquially implies "how
  // much is left before we run out", the same LOW_STOCK intent as
  // "شو ناقصنا" above, added for the Palestinian-dialect upgrade.
  "شو ضل", "شو ضايل", "شو فاضل", "فاضل", "كم فاضل",
  // Bare MSA "ناقص"/"ناقصة" ("المنتجات الناقصة") — the multi-word
  // "الاصناف الناقصة"/"الأصناف الناقصة" phrases above only ever matched
  // that exact noun; a bare adjective entry generalizes to any noun.
  "ناقص", "ناقصة",
  // Bare MSA "نقص" ("هل يوجد نقص في المخزون؟") — the abstract noun form
  // ("shortage"), distinct from the adjective "ناقص" above.
  "نقص",
];

// ---------------------------------------------------------------------------
// Sales / top-selling / price (sections 8-10)
// ---------------------------------------------------------------------------
// Bare forms only for the single-word entries ("اكثر"/"اكتر" families) —
// matchesLexicalGroup (the caller) is clitic-aware, so "الأكتر"/"الاكثر"
// already match via the bare "اكتر"/"اكثر" entries without needing a
// separate ال-prefixed literal for every spelling.
export const TOP_SELLING_WORDS = [
  "اكثر شي انباع", "أكثر شي انباع", "شو اكثر شي ماشي", "شو الأكثر مبيعا", "شو الاكثر مبيعا", "شو ماشي اكثر",
  "الأكثر مبيعاً", "احسن مبيعات", "أعلى مبيعات", "top selling", "best seller", "best selling", "اكثر", "أكثر", "اكتر",
  "أكتر", "top",
];
export const PRICE_WORDS = ["سعر", "سعره", "سعرها", "بكم", "بكام", "كم حقه", "كم حقها", "كم عليه", "price"];
export const WHOLESALE_WORDS = ["جملة", "جمله", "سعر جملة", "سعر الجملة", "للتاجر", "wholesale"];
export const RETAIL_WORDS = ["مفرق", "قطاعي", "مفرد", "لزبون", "retail"];

// ---------------------------------------------------------------------------
// Merchant account overview (section 12)
// ---------------------------------------------------------------------------
/** Phrases that ALWAYS mean the company-wide ranking/overview, regardless
 * of any leftover text (a ranking/"who owes most" question never names one
 * specific merchant). Kept separate from ACCOUNT_OVERVIEW_BARE_WORDS below,
 * which need extra care — see router.ts's own usage: a bare "حساب"/"ذمم" is
 * only an OVERVIEW request when no merchant name is left over ("حساب
 * التجار" vs "حساب محمد" — the same bare word, opposite intents). */
export const ACCOUNT_OVERVIEW_PHRASES = [
  "مين عليه", "مين عليه اكثر", "مين عليه أكثر", "اعلى الذمم", "أعلى الذمم", "اكبر ذمة", "أكبر ذمة",
  "شو وضع التجار", "شو وضع الحسابات", "كم مجموع ذمم", "مجموع ذمم التجار", "ديون التجار",
];
export const ACCOUNT_OVERVIEW_BARE_WORDS = ["حساب", "حسابات", "ذمم", "رصيد", "أرصدة", "ارصدة", "ديون", "مديونية", "مستحقات"];

// ---------------------------------------------------------------------------
// Ranking / comparison (section 29)
// ---------------------------------------------------------------------------
export const RANKING_WORDS = [
  "اكثر", "أكثر", "اكتر", "أكتر", "اعلى", "أعلى", "اقل", "أقل", "اقل شي", "أقل شي", "اكبر", "أكبر",
  "أحسن", "احسن", "أفضل", "افضل", "اسوء", "أسوأ", "top", "best", "highest", "lowest",
];

// ---------------------------------------------------------------------------
// Rep language (sections 14-16)
// ---------------------------------------------------------------------------
/** "مند" is deliberately NOT included as a full word — it's a genuine
 * PARTIAL prefix of "مندوب"/"مندوبين" (see isPrefixOfAny/router.ts's own
 * partial-query handling), never treated as if it were the complete word.
 * "الشب"/"الشباب" are real (if informal) Palestinian shorthand for "the
 * reps" explicitly requested — narrow false-positive risk accepted, same
 * tradeoff the spec itself calls for. */
// Bare forms only (no "ال" baked in) — matchesLexicalGroup/stripArabicClitic
// already recognize the attached form ("المندوب"/"الشباب") by stripping the
// clitic off the MESSAGE token before comparing; storing the term itself
// WITH "ال" would create the same stripped-vs-unstripped mismatch already
// found and fixed for REP_CAR/ACCOUNT_OVERVIEW — never repeat it here.
// "مندوبي" ("my rep(s)") kept as its own literal entry rather than relying
// on the generic possessive-suffix stripper (dialect.ts) — a bare trailing
// "ي" is deliberately NOT auto-stripped there (too many ordinary Arabic
// words end in ي) so this one case is spelled out explicitly instead.
// "موظف"/"سيلز"/"salesman" added for the Palestinian-dialect + mixed-
// language upgrade — further common ways staff refer to a rep.
export const REP_WORDS = [
  "مندوب", "مندوبين", "مندوبي", "مندوب المبيعات", "شب", "شباب", "موظف", "موظف المبيعات", "سيلز", "rep", "sales rep", "salesman",
];
export const REP_PLURAL_WORDS = ["مندوبين", "شباب", "reps"];

// ---------------------------------------------------------------------------
// Payment DIRECTION (intelligence-completion round) — a merchant "دفع"s
// (pays Ovi), a rep "يقبض"/"يحصّل"s (collects on Ovi's behalf); these are
// never interchangeable directions even though both are "PAYMENT" wording
// in the coarser DOMAIN_GLOSSARY.PAYMENT sense (which stays unchanged and
// is still used for the general "is this about payments at all" signal).
// Used ONLY by router.ts to decide which of REP_SUMMARY (a rep's own
// paymentsCollected) vs MERCHANT_ACTIVITY a NAMED payment question means —
// see its own doc comment. Deliberately excludes direction-neutral words
// ("حوالة", "تحويل") that give no reliable signal either way. */
export const REP_COLLECTION_WORDS = ["قبض", "قبضوا", "قبضنا", "تحصيل", "تحصيلا", "تحصيلات", "محصلة", "استلم", "استلمنا", "حصلوا", "حصلوها", "مقبوض", "وصل", "وصلنا"];
export const MERCHANT_PAYMENT_WORDS = ["دفعة", "دفعات", "دفع", "دافع", "سدد", "تسديد"];

// ---------------------------------------------------------------------------
// Location (section 17)
// ---------------------------------------------------------------------------
export const LOCATION_WORDS = [
  "وين", "فين", "وين موجود", "وين الاقيه", "وين ألاقيه", "عند مين", "باي سيارة", "بأي سيارة", "باي مخزن", "بأي مخزن",
  "وين موزع", "وين الكمية", "location", "locations",
];

// ---------------------------------------------------------------------------
// Global / company-wide (section 18)
// ---------------------------------------------------------------------------
export const GLOBAL_WORDS = ["جميع", "كل", "كامل", "كله", "كلهم", "شركة", "اجمالي", "إجمالي", "مجموع", "المجموع", "total"];

// ---------------------------------------------------------------------------
// Negation (section 24)
// ---------------------------------------------------------------------------
export const NEGATION_WORDS = ["مش", "مو", "ما", "مافي", "ما في", "مافيش", "ما فيش", "ولا", "ولا اشي", "ولا إشي"];

// ---------------------------------------------------------------------------
// Relation / possessive / pronoun (sections 20-22)
// ---------------------------------------------------------------------------
/** Possessive/relational words ("جفرات تبع A26", "الجفرات تاعت A26") — these
 * carry NO entity-identifying meaning themselves (safe to strip when
 * isolating an entity name) but signal "the thing belonging to X" — X is
 * whatever real entity/context the rest of the sentence names. */
// "عند" (bare — "عند احمد A26") added for the intelligence-completion
// round: "عنده"/"عندها" (WITH the attached pronoun) were already here, but
// the bare preposition alone — "عند [name] [model]", no pronoun at all —
// wasn't recognized as a relation signal, so "عند احمد A26"/"احمد معه A26"
// fell all the way to a safe-but-unhelpful GENERAL_HELP clarification
// instead of resolving to REP_INVENTORY (see router.ts's own
// `bareRelationInventory` check for where this is used).
// "مع" (bare — "A26 مع احمد؟") added alongside "عند" above: "معه"/"معها"
// (WITH the attached pronoun) were already here, but the bare preposition
// + a separate name ("مع احمد", never fused into one word) wasn't.
export const RELATION_WORDS = ["تبع", "تبعت", "تبعته", "تبعتها", "تبعهم", "تاعت", "تاع", "إله", "اله", "إلها", "الها", "عند", "عنده", "عندها", "مع", "معه", "معها", "منه", "منها", "منهم"];
/** Context-follow-up pronouns ("طيب الجلد؟" then "مين معه منها؟") — resolved
 * against OviAiContext, never treated as new entity text. */
export const CONTEXT_PRONOUNS = ["منه", "منها", "منهم", "فيه", "فيها", "عنه", "عنها", "نفسه", "نفسها", "هاد", "هاي", "هاذ", "هذي", "هالجهاز", "هالموديل"];

// ---------------------------------------------------------------------------
// Filler (section 23) — harmless conversational chatter, safe to strip when
// isolating an entity name; "طيب" deliberately double-duty (also a
// follow-up marker — see router.ts's context-reuse handling, unaffected by
// stripping it here since a filter/entity word surviving alongside it is
// what actually matters).
// ---------------------------------------------------------------------------
export const FILLER_WORDS = [
  "اسمع", "اسمعني", "شوف", "شوفلي", "تفقدلي", "افحصلي", "احسبلي", "ورجيني", "فرجيني", "طلعلي", "اعطيني", "اعطني", "هات",
  "هاتي", "بدي", "بدنا", "بدي اعرف", "بدنا نعرف", "ممكن", "لو سمحت", "بالله", "يزم", "يا زلمة", "يا رجل", "طيب", "طب",
  "هسا", "هسه", "هس", "هينا", "هيني", "هيه", "هلا", "هلقيت", "لسا", "لسه", "يعني", "مثلا", "مثلاً",
  // Vocative/discourse particles ("يا"، "ولك"، "بقولك"/"بقلك") and ranking-
  // request words ("رتب"/"رتبلي"/"حسب" — "رتبلي المندوبين حسب المبيعات")
  // added for the intelligence-completion round — all harmless
  // conversational chatter, never entity-identifying.
  "يا", "ولك", "بقولك", "بقلك", "رتب", "رتبلي", "حسب",
];

// ---------------------------------------------------------------------------
// Read-only / write-action detection (section 40)
// ---------------------------------------------------------------------------
export const WRITE_ACTION_WORDS = [
  "اعمللي", "اعمل لي", "اعمل", "اعملي", "سوي لي", "سوّي لي", "سجل بيع", "سجل مبيعة", "سجل دفعة", "أضف مخزون", "اضف مخزون",
  "انقل مخزون", "حول مخزون", "حوّل مخزون", "الغي", "ألغِ", "الغ", "ألغي", "إلغاء الطلب", "احذف", "امسح", "عدل على",
  "عدّل على", "غيّر على", "عدل السعر", "غير السعر", "أنشئ", "انشئ", "ضيف", "أضف", "اطلع فاتورة", "نزل من المخزون",
  "زود المخزون", "create sale", "create payment", "cancel order", "delete",
];

// ---------------------------------------------------------------------------
// Quantity (section 28) — overlaps QUESTION_HOW_MUCH by design (both signal
// "how many/how much"); kept separate since quantity words also appear
// declaratively ("عدد جفرات A26", not just as a question opener).
// ---------------------------------------------------------------------------
export const QUANTITY_WORDS = ["كم", "قديش", "كديش", "عدد", "كمية", "كميه", "مجموع", "اجمالي", "إجمالي", "total"];

// ---------------------------------------------------------------------------
// Money/currency unit words — carry NO entity-identifying meaning and no
// calculation happens from them; they only mark that a question is ABOUT a
// monetary amount, which is always still answered from a real, canonically-
// computed stored amount (getAccountBalanceCents, order/payment totals, …),
// never derived from the text itself ("كم قبضوا شواكل مبارح" still resolves
// via the real payments tool, never by parsing "شواكل" into a number).
// Stripped from an entity query the same way any other pure-category word
// is (see ENTITY_QUERY_STOPWORDS, features.ts) — "شواكل" left unstripped
// would otherwise look like a leftover entity name and could send the
// engine hunting for a nonexistent merchant/rep/product called "شواكل".
// ---------------------------------------------------------------------------
export const MONEY_UNIT_WORDS = ["شيكل", "شيكلات", "شواكل", "₪", "اغورة", "أغورة", "اغورات", "أغورات", "قرش", "قروش"];
