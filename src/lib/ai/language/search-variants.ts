/** Stage-1 DB retrieval is orthography-sensitive: Prisma's `contains` does a
 * literal, case-insensitive SUBSTRING match against the REAL stored text —
 * it never becomes hamza/alef-insensitive just because the query side was
 * folded. A query typed without a hamza ("احمد") can therefore never even
 * reach fuzzy scoring for a row persisted WITH one ("أحمد"): the row simply
 * never enters the bounded candidate pool the DB query fetches (see
 * tools/merchants.ts / tools/reps.ts's own POOL_FETCH_LIMIT comments). This
 * module closes that specific gap by generating a small, bounded set of
 * alternate LITERAL spellings BEFORE the DB query runs, so the real row
 * actually gets fetched in the first place.
 *
 * This is a genuinely different responsibility from language/dialect.ts's
 * `toMatchable` — that module folds text down to ONE canonical comparison
 * form for in-memory fuzzy SCORING of rows already fetched (and for
 * learned-alias phrase comparison); it is one-directional (many spellings
 * -> one key) and is never used to build a DB filter. This module instead
 * EXPANDS one spelling out to several plausible real spellings, precisely
 * because it IS used to build a DB filter, where only a literal substring
 * match works. The two are complementary, not duplicates: this module gets
 * the right rows INTO the pool; toMatchable then helps RANK that pool.
 *
 * Generated variants are used ONLY to build search filters. They are NEVER
 * stored, NEVER used as a display label (every candidate's label always
 * comes straight from the real DB row — see tools/merchants.ts,
 * tools/reps.ts, tools/catalog.ts), and NEVER mutate a persisted value. */

import { normalizeSearchText, buildSearchVariants } from "@/lib/ai/normalization";

const ALIF_FORMS = ["ا", "أ", "إ", "آ"] as const;

/** Hard cap. This generator is meant for short, entity-name-shaped queries
 * (a person's name, a business name — realistically 1-4 words), never a
 * full sentence. Capping keeps every caller's DB filter small and bounded,
 * consistent with the rest of the local engine's "bounded pool, never an
 * unbounded scan" architecture (see tools/catalog.ts's POOL_FETCH_LIMIT
 * doc comment) — and the bounded generation loop below stops as soon as
 * the cap is hit, so it never materializes a full Cartesian product for a
 * pathological long input either. */
const MAX_RETRIEVAL_VARIANTS = 16;

/** Per-token candidate spellings for the LEADING alif-family letter only
 * (ا/أ/إ/آ) — by far the most common source of a real Palestinian-name
 * hamza mismatch ("احمد" vs "أحمد", "ابراهيم" vs "إبراهيم", "الاء" vs
 * "آلاء"). Only the FIRST character of the token is varied — expanding
 * every internal alif too would combinatorially explode for longer words
 * for essentially no real-world benefit (a hamza deep inside a word is
 * comparatively rare in practice, and typo-tolerant fuzzy scoring already
 * covers a stray one once a row is fetched). A token that doesn't start
 * with one of these four letters is returned unchanged — most tokens in a
 * typical query (an action word, a model code, "مندوب", …) fall straight
 * through here with zero cost. */
function leadingAlifVariants(token: string): string[] {
  if (token.length === 0) return [token];
  const first = token[0]!;
  if (!(ALIF_FORMS as readonly string[]).includes(first)) return [token];
  const rest = token.slice(1);
  return ALIF_FORMS.map((alif) => `${alif}${rest}`);
}

/** Cheap, single-pass substitutions for the mid-word hamza-carrying letters
 * a leading-letter expansion can't reach — "مؤيد" vs "مويد" (ؤ/و), or a
 * hypothetical "بئر"-style ئ/ي case. Applied to the WHOLE string at once
 * (never per-token), so it can never multiply against the Cartesian
 * product above — each direction only runs when its source character is
 * actually present, so a query with no ؤ/ئ costs nothing extra. Per spec,
 * this is a "where reasonable for search only" best-effort widening, not a
 * guaranteed-recall mechanism the way the leading-alif expansion above is —
 * a name that still isn't found this way can still fall back to fuzzy
 * scoring once ANY spelling of it is in the pool. */
function midWordHamzaVariants(text: string): string[] {
  const out: string[] = [];
  if (text.includes("ؤ")) out.push(text.replace(/ؤ/g, "و"));
  else if (text.includes("و")) out.push(text.replace(/و/g, "ؤ"));
  if (text.includes("ئ")) out.push(text.replace(/ئ/g, "ي"));
  else if (text.includes("ي")) out.push(text.replace(/ي/g, "ئ"));
  return out;
}

/** Generates a small, bounded, deduplicated set of alternate literal
 * spellings for a human-entity-name-shaped query, for use ONLY when
 * building a DB candidate-fetch filter (see the file-level doc comment for
 * why this is architecturally distinct from language/dialect.ts's
 * `toMatchable`). Always includes the plain normalized query as its first
 * element, so a caller migrating from a single string loses no existing
 * behavior — this only ever ADDS candidate spellings, never removes the
 * original. Returns [] for an empty/whitespace-only query. */
export function buildRetrievalVariants(raw: string): string[] {
  const base = normalizeSearchText(raw);
  if (!base) return [];

  const results: string[] = [base];
  const seen = new Set<string>([base]);
  const tryPush = (variant: string): boolean => {
    if (results.length >= MAX_RETRIEVAL_VARIANTS) return false;
    if (seen.has(variant)) return true;
    seen.add(variant);
    results.push(variant);
    return true;
  };

  const tokens = base.split(" ").filter(Boolean);
  const perTokenVariants = tokens.map(leadingAlifVariants);

  // Bounded Cartesian product over each token's leading-alif alternates —
  // short-circuits the instant the cap is hit, so it never fully
  // materializes for a long input. Iterated depth-first so the FIRST
  // combos generated are the ones that vary the earliest tokens first,
  // which is fine: order only affects which combos get dropped once the
  // (generous, 16-wide) cap is reached, never correctness for the realistic
  // 1-2 alif-bearing-token names this exists for.
  const combine = (index: number, acc: string[]): boolean => {
    if (results.length >= MAX_RETRIEVAL_VARIANTS) return false;
    if (index === perTokenVariants.length) {
      tryPush(acc.join(" "));
      return results.length < MAX_RETRIEVAL_VARIANTS;
    }
    for (const option of perTokenVariants[index]!) {
      if (!combine(index + 1, [...acc, option])) return false;
    }
    return true;
  };
  combine(0, []);

  // Mid-word waw/yaa-hamza swaps of the original string — covers names
  // with no LEADING alif at all ("مؤيد") that the combinator above never
  // touches. Only runs if room remains under the cap.
  for (const swapped of midWordHamzaVariants(base)) {
    tryPush(swapped);
  }

  return results.slice(0, MAX_RETRIEVAL_VARIANTS);
}

/** What searchMerchants/searchReps (tools/merchants.ts, tools/reps.ts)
 * actually build their DB `OR` filter from: the union of the existing
 * structural variants (normalization.ts's `buildSearchVariants` — whole
 * phrase, filler-stripped, compact-alphanumeric; still needed for a
 * phone-number or mixed alphanumeric query) and this file's alif/hamza
 * expansion of the plain query, deduplicated and capped at the same
 * MAX_RETRIEVAL_VARIANTS bound so a human-name search never fans out into
 * more DB filter branches than a catalog search does. */
export function buildEntityRetrievalVariants(raw: string): string[] {
  const structural = buildSearchVariants(raw);
  const hamzaExpanded = buildRetrievalVariants(raw);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const variant of [...structural, ...hamzaExpanded]) {
    if (seen.has(variant)) continue;
    seen.add(variant);
    merged.push(variant);
    if (merged.length >= MAX_RETRIEVAL_VARIANTS) break;
  }
  return merged;
}
