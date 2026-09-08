/** Deterministic text normalization for Ovi AI's DB-side candidate search —
 * runs BEFORE any Prisma `contains` query, on both the model's extracted
 * search terms and the raw user message. Never destroys a real product/model
 * distinction (no letter-merging, no stemming) — only case/digit/whitespace/
 * punctuation normalization and a small, maintainable synonym glossary the
 * search layer can optionally use to widen (never narrow) a query. The model
 * itself carries most of the "understand Arabic/English mixed, colloquial,
 * misspelled" burden (see system-prompt.ts) — this module is the reliable
 * deterministic floor underneath it, not a replacement for it. */

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

/** Arabic diacritics (tashkeel) + tatweel — purely decorative marks that
 * never carry a distinct product/model identity, safe to strip. Does NOT
 * touch base letters (no ة/ه or أ/إ/ا merging — those ARE meaningfully
 * distinct in real product names and must never be collapsed). */
const DIACRITICS_PATTERN = /[ً-ٰٟـ]/g;

/** Lowercases Latin letters, converts Arabic-Indic digits to Latin digits,
 * strips diacritics/tatweel, collapses whitespace/common separators
 * (hyphens, underscores, slashes) into single spaces, and trims. This is the
 * one normalization every search string (from the user OR from a tool-call
 * argument) should pass through before being used in a `contains` filter. */
export function normalizeSearchText(input: string): string {
  let text = input.toLowerCase();
  text = text.replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] ?? digit);
  text = text.replace(DIACRITICS_PATTERN, "");
  text = text.replace(/[-_/]+/g, " ");
  text = text.replace(/[.,،؛;!؟?"'`]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** A compact, no-separator form for tolerant matching of model codes typed
 * with inconsistent spacing — "a 26", "a-26", "A26" all become "a26". Only
 * used as an ADDITIONAL search variant (see buildSearchVariants), never in
 * place of the spaced form — collapsing a genuine multi-word product name
 * this way would create false matches, so callers only use this for the
 * short, code-like queries it's meant for. */
export function compactAlphaNumeric(input: string): string {
  return normalizeSearchText(input).replace(/\s+/g, "");
}

/** Small, maintainable domain glossary — NOT an attempt to hard-code every
 * possible sentence. Groups map a canonical concept to the real words Ovi
 * staff actually type for it. Used two ways: (1) FILLER terms are stripped
 * from a raw user phrase to isolate the likely model/product code before
 * searching (e.g. "جفرات A26" -> "A26"); (2) the whole glossary is embedded
 * in the system prompt so the model itself recognizes these terms without
 * the server needing to special-case every sentence shape. */
/** Real Ovi production catalog data names case/cover products with the bare
 * stem "جفر" (no تاء مربوطة), not only "جفرة"/"جفرات" — added after a real
 * production test showed persisted product names like "جفر شفاف"/"جفر دفتر"/
 * "كفر جلد" that the original term list (with the ة suffix only) missed. */
const CASE_COVER_TERMS = ["جفر", "جفرة", "جفرات", "كفر", "كفرات", "غطاء", "أغطية", "cover", "case"];

/** SCREEN_PROTECTOR is a distinct accessory category from CASE_COVER — never
 * conflated with it, and never conflated with "شفاف" either (see
 * classifyProductScope's own doc comment in local/product-scope.ts): "شفاف"
 * is a material/color word (a CLEAR case can be "شفاف", but so could a
 * screen protector's own finish) — category classification is decided by
 * product/category NAME text, never by a material word alone. */
const SCREEN_PROTECTOR_TERMS = ["لزقة", "لزقات", "لزقه", "حماية شاشة", "screen protector", "glass", "privacy"];

export const DOMAIN_GLOSSARY: Record<string, string[]> = {
  CASE_COVER: CASE_COVER_TERMS,
  SCREEN_PROTECTOR: SCREEN_PROTECTOR_TERMS,
  RANGE: ["رنج", "range"],
  LEATHER: ["جلد"],
  CLEAR: ["شفاف"],
  MAGSAFE: ["ماغ سيف", "ماغسيف", "magsafe", "mag safe"],
  ULTRA: ["الترا", "ultra"],
  // Bare stems (no attached "ال") — every OTHER glossary group already
  // stores its terms bare; REP_CAR used to store "المندوب"/"المندوبين" WITH
  // the definite article baked in, which silently broke local/router.ts's
  // clitic-aware stopword/wording checks (they clitic-STRIP a message token
  // before comparing it against this list, so a stored "المندوب" could
  // never match a stripped "مندوب" — found auditing real production
  // failures on "دفعات المندوبين"). Fixed to the same bare convention as
  // every other group; router.ts's own clitic-stripping already handles the
  // attached forms correctly from here.
  REP_CAR: ["سيارة", "سيارات", "مندوب", "مندوبين"],
  WAREHOUSE: ["المستودع", "المخزن"],
  MERCHANT: ["تاجر", "تجار", "زبون", "عميل"],
  PAYMENT: ["دفعة", "دفعات", "سند قبض"],
  DEBT: ["ذمة", "دين", "عليه", "له"],
  SALE: ["باع", "بعنا", "بيع", "مبيعات"],
  RETURN: ["رجع", "مرتجع", "إرجاع"],
};

/** Terms that describe an ACCESSORY CATEGORY, not a device-model code — safe
 * to strip from a phrase before searching PhoneModel/Product names, since
 * "جفرات A26" should search for "A26", not literally contain the word
 * "جفرات". Deliberately only the CASE_COVER + a few generic Arabic question/
 * filler words — never a word that could itself be part of a real product
 * name (so "شو عنا" is stripped but "شفاف"/"جلد" — real Color names — never
 * are, those stay meaningful and searchable). */
const FILLER_TERMS = [
  ...CASE_COVER_TERMS,
  "شو",
  "عنا",
  "عندنا",
  "عندكم",
  "فيه",
  "في",
  "من",
  "ال",
];

/** Strips FILLER_TERMS (as whole words) from an already-normalized phrase,
 * collapsing any resulting extra whitespace. Returns the ORIGINAL phrase
 * unchanged if stripping would leave nothing (never search for an empty
 * string). */
export function stripFillerTerms(normalized: string): string {
  const words = normalized.split(" ").filter((word) => word.length > 0 && !FILLER_TERMS.includes(word));
  const stripped = words.join(" ").trim();
  return stripped.length > 0 ? stripped : normalized;
}

/** Builds a small, deduplicated set of search-string variants to try against
 * the database for one user-supplied term — the deterministic half of the
 * two-stage "search real candidates, then let the model pick/ask" pattern.
 * Capped at 4 variants so a single candidate search never fans out into an
 * unbounded number of queries. */
export function buildSearchVariants(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  variants.add(stripFillerTerms(normalized));

  const compact = compactAlphaNumeric(normalized);
  if (compact && compact.length <= 24) {
    variants.add(compact);
  }

  return [...variants].slice(0, 4);
}
