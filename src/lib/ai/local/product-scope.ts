/** Classifies a REAL persisted product into a first-class local scope
 * concept — the thing that makes "جفرات A26؟" correctly mean "case/cover
 * products compatible with A26" and NOT "every compatible accessory
 * including screen protectors", which real production data showed the
 * original broad-compatibility inventory answer was quietly doing wrong.
 *
 * Deliberately keyword-driven off each product's OWN real name/category
 * text (DOMAIN_GLOSSARY's CASE_COVER/SCREEN_PROTECTOR groups,
 * normalization.ts) — never a hardcoded product/category id list, and never
 * a "range"/synthetic field this schema doesn't have. Pure, no DB, no
 * "server-only" — safe to import from both the (server-only) tools/**.ts
 * files and from local/router.ts's own message-side scope detection. */

import { normalizeSearchText, DOMAIN_GLOSSARY } from "@/lib/ai/normalization";

export type ProductScope = "CASE_COVER" | "SCREEN_PROTECTOR" | "OTHER";

const CASE_COVER_TERMS = (DOMAIN_GLOSSARY.CASE_COVER ?? []).map(normalizeSearchText);
const SCREEN_PROTECTOR_TERMS = (DOMAIN_GLOSSARY.SCREEN_PROTECTOR ?? []).map(normalizeSearchText);

/** Strips a leading Arabic definite article "ال" from EACH word of a
 * normalized string — e.g. "حماية الشاشة والعدسات" -> "حماية شاشة والعدسات".
 * Needed because a persisted category/product name attaches "ال" to its own
 * words freely ("الشاشة"), while DOMAIN_GLOSSARY's own multi-word terms
 * ("حماية شاشة") are stored bare — the exact same class of mismatch found
 * and fixed for REP_CAR's single-word terms in local/router.ts, applied
 * here to the (also substring-matched) category/name haystack instead of a
 * message token. Deliberately conservative — only the "ال" prefix, only
 * when the remaining word is still non-trivial (length > 3), never a
 * broader stemmer. */
function stripDefiniteArticles(text: string): string {
  return text
    .split(" ")
    .map((word) => (word.startsWith("ال") && word.length > 3 ? word.slice(2) : word))
    .join(" ");
}

function containsAnyTerm(haystack: string, terms: string[]): boolean {
  const normalizedHaystack = stripDefiniteArticles(haystack);
  return terms.some((term) => term.length > 0 && normalizedHaystack.includes(term));
}

export interface ProductScopeInput {
  name: string;
  nameAr?: string | null;
  categoryName?: string | null;
  categoryNameAr?: string | null;
}

/** Category text is checked first (the more deliberate signal when a shop
 * consistently categorizes its catalog), falling back to the product's own
 * name — the signal real Ovi production data actually relies on today (see
 * the "جفر شفاف"/"جفر دفتر"/"كفر جلد" vs "لزقه شاشة زجاج" real examples this
 * was built from: case/cover and screen-protector products are both
 * distinguished by their own NAME text, not necessarily a dedicated
 * Category row). Substring matching (not exact-token) on purpose — product
 * names are compound ("جفرة شفافة", "لاصقة حماية شاشة زجاجية") and the
 * category word is rarely the whole string. IMPORTANT: "شفاف" is
 * deliberately NOT a CASE_COVER/SCREEN_PROTECTOR term — it is a material/
 * color word (DOMAIN_GLOSSARY.CLEAR) that can legitimately appear in either
 * category's product names, so it carries no category signal on its own. */
export function classifyProductScope(input: ProductScopeInput): ProductScope {
  const categoryText = normalizeSearchText([input.categoryNameAr, input.categoryName].filter(Boolean).join(" "));
  if (categoryText) {
    if (containsAnyTerm(categoryText, CASE_COVER_TERMS)) return "CASE_COVER";
    if (containsAnyTerm(categoryText, SCREEN_PROTECTOR_TERMS)) return "SCREEN_PROTECTOR";
  }
  const nameText = normalizeSearchText([input.nameAr, input.name].filter(Boolean).join(" "));
  if (containsAnyTerm(nameText, CASE_COVER_TERMS)) return "CASE_COVER";
  if (containsAnyTerm(nameText, SCREEN_PROTECTOR_TERMS)) return "SCREEN_PROTECTOR";
  return "OTHER";
}

/** What the local engine actually filters BY — narrower than ProductScope
 * (no "OTHER": nothing ever explicitly asks for "other", and it's never a
 * meaningful request/context value, only a per-product classification
 * outcome). `null` means no explicit scope was requested — broad/all
 * compatible types. */
export type RequestedProductScope = "CASE_COVER" | "SCREEN_PROTECTOR";
