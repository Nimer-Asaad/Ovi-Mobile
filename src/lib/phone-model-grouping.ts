/** Pure, presentation-only helpers for grouping/sorting/searching a phone
 * model picker's chip list on the storefront product page. Never touch a
 * model's real `id` — these only reorder/group/filter the SAME options the
 * caller already has (see ProductPurchasePanel/PhoneModelGrid), so the value
 * that ultimately reaches setSelectedModelId/setSelectedDcModelId is always
 * an unmodified, real PhoneModel id. */

export interface GroupableModel {
  id: string;
  name: string;
  nameAr: string | null;
}

export interface ModelGroup<T extends GroupableModel> {
  label: string;
  models: T[];
}

const OTHER_GROUP_LABEL = "أخرى";

/** Splits a model code into alternating non-digit/digit chunks so numeric
 * runs compare by value ("A2" < "A10") instead of lexically ("A10" < "A2").
 * Case-folded; never mutates the original label anywhere else. */
function splitIntoChunks(value: string): (string | number)[] {
  const chunks = value.toLowerCase().match(/\d+|\D+/g) ?? [];
  return chunks.map((chunk) => (/^\d+$/.test(chunk) ? Number(chunk) : chunk));
}

/** Natural (numeric-aware) comparator for model codes — "A2" before "A10",
 * "S20 FE" before "S21", while suffixes like "FE"/"Ultra"/"PLUS"/"Pro" still
 * sort predictably as trailing text chunks. Never mutates either input. */
export function naturalCompare(a: string, b: string): number {
  const chunksA = splitIntoChunks(a);
  const chunksB = splitIntoChunks(b);
  const len = Math.max(chunksA.length, chunksB.length);
  for (let i = 0; i < len; i++) {
    const chunkA = chunksA[i];
    const chunkB = chunksB[i];
    if (chunkA === undefined) return -1;
    if (chunkB === undefined) return 1;
    if (typeof chunkA === "number" && typeof chunkB === "number") {
      if (chunkA !== chunkB) return chunkA - chunkB;
      continue;
    }
    const strA = String(chunkA);
    const strB = String(chunkB);
    if (strA !== strB) return strA < strB ? -1 : 1;
  }
  return 0;
}

/** Known letter-prefix families for brands that consistently code their
 * model names this way (Samsung's A/S/J/M/Note lines). Deliberately narrow —
 * anything not confidently matched here falls into OTHER_GROUP_LABEL rather
 * than guessing at a grouping that could misrepresent a real model name. */
const LETTER_SERIES_PATTERN = /^([A-Za-z])\s?-?\d/;
const NOTE_SERIES_PATTERN = /^note\b/i;
const IPHONE_PATTERN = /^iphone\b/i;

/** Derives a display group label for one model's raw name, never inventing
 * or altering the model's own name/nameAr — only classifying it. Falls back
 * to OTHER_GROUP_LABEL whenever the shape isn't confidently recognized. */
export function classifyModelGroup(modelName: string): string {
  const trimmed = modelName.trim();
  if (IPHONE_PATTERN.test(trimmed)) return "iPhone";
  if (NOTE_SERIES_PATTERN.test(trimmed)) return "سلسلة Note";
  const letterMatch = trimmed.match(LETTER_SERIES_PATTERN);
  const letter = letterMatch?.[1];
  if (letter) return `سلسلة ${letter.toUpperCase()}`;
  return OTHER_GROUP_LABEL;
}

/** Groups models by family and natural-sorts within each group; groups
 * themselves are ordered A/J/M/S/Note/iPhone-style by first appearance
 * priority (letter series alphabetically, iPhone and Note pinned after the
 * single-letter series, OTHER_GROUP_LABEL always last). Every model keeps
 * its original object (id/name/nameAr untouched) — this only reorders and
 * buckets, never mutates or drops a model. */
export function groupAndSortModels<T extends GroupableModel>(models: T[]): ModelGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const model of models) {
    const label = classifyModelGroup(model.name);
    const bucket = groups.get(label);
    if (bucket) bucket.push(model);
    else groups.set(label, [model]);
  }

  const labels = [...groups.keys()].sort((a, b) => {
    if (a === OTHER_GROUP_LABEL) return 1;
    if (b === OTHER_GROUP_LABEL) return -1;
    return a.localeCompare(b);
  });

  return labels.map((label) => ({
    label,
    models: [...groups.get(label)!].sort((a, b) => naturalCompare(a.name, b.name)),
  }));
}

/** Normalizes a model label or search query for tolerant matching: lowercase,
 * strip spaces/hyphens/underscores/slashes so "A 26" / "A-26" / "A26" /
 * "A/26" all collapse to the same "a26" form. Deliberately more aggressive
 * than src/lib/ai/normalization.ts's normalizeSearchText (which preserves
 * spaces) — this is a display-label search helper for a short, code-like
 * chip list, not the AI engine's query normalizer, so the two intentionally
 * stay separate. */
export function normalizeModelQuery(value: string): string {
  return value.toLowerCase().replace(/[\s\-_/]+/g, "");
}

/** True when a user's search query matches a model's display label — after
 * normalizing both sides, and also checking each "/"-separated segment of a
 * compound label (e.g. "A17/A26") independently, so searching "A26" matches
 * a model stored as "A17/A26" even though the compact forms of the whole
 * label and the query differ. */
export function modelLabelMatchesQuery(label: string, query: string): boolean {
  const normalizedQuery = normalizeModelQuery(query);
  if (!normalizedQuery) return true;
  const normalizedLabel = normalizeModelQuery(label);
  if (normalizedLabel.includes(normalizedQuery)) return true;
  return label.split("/").some((segment) => normalizeModelQuery(segment).includes(normalizedQuery));
}
