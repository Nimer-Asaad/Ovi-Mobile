/** The ONE grouping used by the printable rep-car dispatch note
 * (src/lib/rep-dispatch-note.ts): every positive-stock product maps to
 * EXACTLY ONE of six business groups, and the note prints one big quantity per
 * group instead of one row per product.
 *
 * Pure (no database, no React): the classification looks only at the product's
 * own names and its category's names — never at SKU numbers — and changes
 * nothing in the catalog. It is a presentation grouping only.
 *
 * Priority (first match wins, so a product can never be in two groups):
 *   1 CABLES  2 CHARGERS  3 STICKERS  4 PROTECTORS  5 MAINTENANCE
 *   6 OTHER_ACCESSORIES  <- the fallback for everything unclassified.
 *
 * Resolution order for one product:
 *   a) explicit business exceptions by name (currently "مرتبان" = a cable,
 *      "حتى المرتبانات كوابل"),
 *   b) the CATEGORY, which is authoritative when it names a group,
 *   c) only when the category says nothing (no category, or a generic one
 *      such as "كفرات"): the product's own NAME as a fallback for legacy /
 *      misclassified products,
 *   d) OTHER_ACCESSORIES. */

export type DispatchGroupKey = "CABLES" | "CHARGERS" | "STICKERS" | "PROTECTORS" | "MAINTENANCE" | "OTHER_ACCESSORIES";

/** The printed order — never alphabetical. */
export const DISPATCH_GROUPS: readonly { key: DispatchGroupKey; label: string }[] = [
  { key: "CABLES", label: "كوابل" },
  { key: "CHARGERS", label: "شواحن وعضمات شحن" },
  { key: "STICKERS", label: "ستكرات" },
  { key: "PROTECTORS", label: "لزقات وحماية" },
  { key: "MAINTENANCE", label: "صيانة" },
  { key: "OTHER_ACCESSORIES", label: "باقي الإكسسوارات" },
];

export interface DispatchClassifiable {
  name: string;
  nameAr: string | null;
  category: { name: string; nameAr: string | null } | null;
}

/** Arabic spelling variants collapse to one form so "صيانة"/"صيانه",
 * "لزقة"/"لزقه", "أ/إ/آ" all compare equal; diacritics and tatweel are
 * dropped; Latin is lower-cased. */
export function normalizeDispatchText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type Rule = { key: Exclude<DispatchGroupKey, "OTHER_ACCESSORIES">; pattern: RegExp };

/** Matched against the category's names (name + nameAr). */
const CATEGORY_RULES: readonly Rule[] = [
  { key: "CABLES", pattern: /كابل|كيبل|كوابل|cable/ },
  { key: "CHARGERS", pattern: /شواحن|شاحن|ع[ظض]مات|ع[ظض]مه|charger/ },
  { key: "STICKERS", pattern: /ستكر|ستيكر|ملصق|sticker/ },
  { key: "PROTECTORS", pattern: /حمايه|لزق|protector/ },
  { key: "MAINTENANCE", pattern: /صيان|maintenance/ },
];

/** Matched against the product's own names — a fallback only. */
const NAME_RULES: readonly Rule[] = [
  { key: "CABLES", pattern: /كيبل|كابل|كوابل|\bcable\b/ },
  { key: "CHARGERS", pattern: /شاحن|شواحن|ع[ظض]مه شحن|ع[ظض]مات شحن|\bcharger\b|\badapter\b/ },
  { key: "STICKERS", pattern: /ستكر|ستيكر|\bsticker/ },
  { key: "PROTECTORS", pattern: /لزق|حمايه الشاشه|حمايه العدسه|حمايه الكاميرا|\bprotector\b|\bprivacy\b|tempered/ },
  { key: "MAINTENANCE", pattern: /^صيان/ },
];

/** Explicit, user-requested exceptions — checked before the category. */
const NAME_EXCEPTIONS: readonly Rule[] = [{ key: "CABLES", pattern: /مرتبان/ }];

function firstMatch(rules: readonly Rule[], haystack: string): DispatchGroupKey | null {
  for (const rule of rules) if (rule.pattern.test(haystack)) return rule.key;
  return null;
}

/** The single canonical classification: always exactly one group. */
export function classifyDispatchProduct(product: DispatchClassifiable): DispatchGroupKey {
  const names = [product.nameAr, product.name].filter((value): value is string => Boolean(value && value.trim())).map(normalizeDispatchText).join(" | ");
  const exception = firstMatch(NAME_EXCEPTIONS, names);
  if (exception) return exception;

  if (product.category) {
    const categoryNames = [product.category.nameAr, product.category.name].filter((value): value is string => Boolean(value && value.trim())).map(normalizeDispatchText).join(" | ");
    const byCategory = firstMatch(CATEGORY_RULES, categoryNames);
    if (byCategory) return byCategory;
  }
  return firstMatch(NAME_RULES, names) ?? "OTHER_ACCESSORIES";
}

export interface DispatchGroupRow {
  key: DispatchGroupKey;
  label: string;
  /** Sum of the quantities of every product in the group — the number printed. */
  quantity: number;
  /** How many products the group stands for (secondary information). */
  productCount: number;
}

/** Sums quantities per group in the fixed business order, dropping groups
 * whose total is 0. Every input row lands in exactly one group, so the group
 * quantities always add up to the input total — see assertGroupsReconcile. */
export function groupDispatchQuantities(rows: readonly { groupKey: DispatchGroupKey; quantity: number }[]): DispatchGroupRow[] {
  return DISPATCH_GROUPS.map((group) => {
    const members = rows.filter((row) => row.groupKey === group.key);
    return { key: group.key, label: group.label, quantity: members.reduce((sum, row) => sum + row.quantity, 0), productCount: members.length };
  }).filter((group) => group.quantity > 0);
}

/** Hard integrity check: no product lost, none counted twice. */
export function assertGroupsReconcile(rows: readonly { quantity: number }[], groups: readonly DispatchGroupRow[]): void {
  const rowTotal = rows.reduce((sum, row) => sum + row.quantity, 0);
  const groupTotal = groups.reduce((sum, group) => sum + group.quantity, 0);
  const groupedProducts = groups.reduce((sum, group) => sum + group.productCount, 0);
  if (rowTotal !== groupTotal || groupedProducts !== rows.length) {
    throw new Error(`DISPATCH_GROUP_MISMATCH: products ${rows.length}/${groupedProducts}, pieces ${rowTotal}/${groupTotal}`);
  }
}
