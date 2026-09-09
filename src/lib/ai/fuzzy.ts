/** Deterministic fuzzy/typo-tolerant candidate ranking — the layer that
 * turns "a 26 altra" into a confident match against a REAL persisted
 * "Samsung A26 Ultra" row. Pure functions, no DB access, safe to unit test
 * directly (no "server-only" import). Used by every candidate-search tool
 * (catalog/merchants/reps) AFTER a bounded DB pool fetch — this module never
 * decides what to fetch, only how to rank what was already fetched. */

import { normalizeSearchText, DOMAIN_GLOSSARY, stripFillerTerms } from "@/lib/ai/normalization";
import { toMatchable } from "@/lib/ai/language/dialect";
import { buildRetrievalVariants } from "@/lib/ai/language/search-variants";

/** Every glossary group is a set of interchangeable terms for the SAME
 * concept (e.g. "الترا" / "ultra") — cross-script synonyms a Levenshtein
 * edit distance could never catch (different alphabets entirely), so they're
 * matched by explicit, deterministic group membership instead. */
const SYNONYM_GROUPS: string[][] = Object.values(DOMAIN_GLOSSARY).map((group) => group.map((term) => normalizeSearchText(term)));

function synonymScore(a: string, b: string): number {
  if (a === b) return 1;
  return SYNONYM_GROUPS.some((group) => group.includes(a) && group.includes(b)) ? 1 : 0;
}

/** Standard Levenshtein edit distance (single-array DP — O(n*m) time,
 * O(min(n,m)) space). Only ever called on short tokens (product/model
 * words), never full sentences, so this stays cheap. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow.push(Math.min(currentRow[j - 1]! + 1, previousRow[j]! + 1, previousRow[j - 1]! + cost));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length]!;
}

/** Normalized edit similarity in [0, 1] — 1 means identical, 0 means
 * maximally different relative to the longer string's length. Handles
 * typos like "altra"->"ultra" (distance 2, length 5 -> similarity 0.6) and
 * "ultara"->"ultra" (distance 1, length 6 -> similarity ~0.83). */
function editSimilarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLength;
}

/** Only trust a fuzzy (non-exact, non-synonym) token match above this
 * similarity — below it, two words are more likely unrelated than a typo of
 * each other. Tuned so "altra"~"ultra" (0.6) and "ultara"~"ultra" (~0.83)
 * both clear it, while unrelated short words don't accidentally match. */
const FUZZY_TOKEN_THRESHOLD = 0.6;

/** Best-match score in [0, 1] between one query token and one label token —
 * exact/synonym (1.0) > one-is-prefix-of-other (0.9) > substring (0.75) >
 * edit-distance fuzzy match above FUZZY_TOKEN_THRESHOLD, else 0 (no credit
 * for genuinely unrelated words). The edit-distance tier ALSO tries the
 * dialect-folded form of both tokens (language/dialect.ts's `toMatchable` —
 * hamza/alef-maksura unification + expressive-repeat collapsing, e.g.
 * "أحمد" vs "احمد", "كمييييه" vs "كمية") and keeps whichever similarity is
 * higher — a small, deliberately narrow additional signal (never replacing
 * the raw-form comparison, only ever able to RAISE a score that edit
 * distance alone judged too low), not a second typo-list to maintain. */
function tokenScore(queryToken: string, labelToken: string): number {
  if (queryToken.length === 0 || labelToken.length === 0) return 0;
  if (queryToken === labelToken || synonymScore(queryToken, labelToken) === 1) return 1;
  if (labelToken.startsWith(queryToken) || queryToken.startsWith(labelToken)) return 0.9;
  if (labelToken.includes(queryToken) || queryToken.includes(labelToken)) return 0.75;
  const similarity = editSimilarity(queryToken, labelToken);
  const dialectSimilarity = editSimilarity(toMatchable(queryToken), toMatchable(labelToken));
  const best = Math.max(similarity, dialectSimilarity);
  return best >= FUZZY_TOKEN_THRESHOLD ? best : 0;
}

/** Extracts real "letter(s) + digits" model codes from a query — e.g. "A26",
 * "a 26", "A-26", "a_26" all extract "a26"; "S26"/"s 26" extract "s26". NOT
 * brand-specific (no hardcoded "A"/"S" list) — any short (1–3 char) bare
 * letter token immediately followed by a bare digit token is merged, and
 * any token already fused with no separator ("a26") is recognized as-is.
 * Deliberately does NOT merge in the other direction: "16 Pro"/"16 Pro Max"
 * never produces a fabricated code like "16p" or "i16" — a digit token with
 * no PRECEDING short letter token contributes no model code at all (see
 * scoreCandidateLabel's own doc comment for why "26 ultra" alone, with no
 * letter prefix, must legitimately stay ambiguous between "A26" and "S26"). */
export function extractModelCodes(rawQuery: string): string[] {
  const normalized = normalizeSearchText(rawQuery);
  const tokens = normalized.split(" ").filter(Boolean);
  const codes = new Set<string>();

  tokens.forEach((token, index) => {
    if (/^[a-z]+\d+$/.test(token)) {
      codes.add(token);
      return;
    }
    if (/^\d+$/.test(token)) {
      const previous = tokens[index - 1];
      if (previous && /^[a-z]{1,3}$/.test(previous)) {
        codes.add(`${previous}${token}`);
      }
    }
  });

  return [...codes];
}

/** How much an EXACT model-code match (see extractModelCodes) outweighs
 * everything else in scoreCandidateLabel — large enough that "A26 Ultra"
 * decisively beats "S26 Ultra" for the query "a 26 altra" even though both
 * candidates share the bare digit "26" and both fuzzy-match "ultra"/"altra"
 * equally well; the letter is what actually distinguishes the two real
 * devices, so once it's present in the query it must dominate. Deliberately
 * NOT a bonus for merely sharing a bare digit — that would recreate the
 * exact "S26 nearly ties A26 Ultra" problem this constant exists to fix. */
const MODEL_CODE_MATCH_BONUS = 35;

export type MatchType = "EXACT" | "EXACT_COMPACT" | "PREFIX" | "CONTAINS" | "FUZZY" | "WEAK";

export interface FuzzyScore {
  /** 0–100, rounded — internal ranking signal, never shown to the end user
   * as a raw number (see the feature report's confidence-bands section). */
  score: number;
  matchType: MatchType;
}

/** Scores one real, persisted candidate label against the user's raw query
 * — the deterministic core of the whole fuzzy-resolution feature. Never
 * invents anything: both `rawQuery` and `label` are always real strings (the
 * query the user actually typed, and a label read straight off a DB row).
 *
 * Combines three signals:
 *   1. Token-level: each MEANINGFUL query token's (length >= 2 — a bare
 *      single letter like the stray "a" left over from "a 26" carries no
 *      reliable signal on its own; e.g. "samsung".includes("a") would
 *      otherwise inflate unrelated labels) BEST match against any label
 *      token (via tokenScore — exact/synonym/prefix/substring/edit-
 *      distance), averaged across those tokens. Naturally rewards a label
 *      matching MORE of the query's distinct words.
 *   2. Whole-compact-string edit similarity (spaces removed) — catches
 *      spacing/punctuation variance the token split might fragment
 *      differently ("a26" vs "a 26" vs "a-26").
 *   3. MODEL_CODE_MATCH_BONUS — added ONLY when a real extracted model code
 *      (extractModelCodes — "a26", not merely the bare digit "26") appears
 *      as an EXACT token in the label. This is what makes "a 26 altra"
 *      decisively prefer "A26 Ultra" over "S26 Ultra": both share the bare
 *      digit "26" and both fuzzy-match "ultra", so signals 1–2 alone score
 *      them nearly identically — the letter is the only thing that actually
 *      distinguishes the two real devices, so once the query supplies it,
 *      it must dominate. A query with NO letter prefix ("26 ultra") earns
 *      no such bonus for either candidate, so they legitimately stay tied —
 *      this is intentional, not a gap (see fuzzy Test 3 in the feature
 *      report): the query itself doesn't disambiguate, so the ranking
 *      shouldn't either. */
export function scoreCandidateLabel(rawQuery: string, label: string): FuzzyScore {
  const query = normalizeSearchText(rawQuery);
  const normalizedLabel = normalizeSearchText(label);
  if (!query || !normalizedLabel) return { score: 0, matchType: "WEAK" };

  if (query === normalizedLabel) return { score: 100, matchType: "EXACT" };

  const compactQuery = query.replace(/\s+/g, "");
  const compactLabel = normalizedLabel.replace(/\s+/g, "");
  if (compactQuery === compactLabel) return { score: 97, matchType: "EXACT_COMPACT" };

  const queryTokens = query.split(" ").filter(Boolean);
  const meaningfulQueryTokens = queryTokens.filter((token) => token.length >= 2);
  const scoredTokens = meaningfulQueryTokens.length > 0 ? meaningfulQueryTokens : queryTokens;
  const labelTokens = normalizedLabel.split(" ").filter(Boolean);

  let tokenScoreSum = 0;
  for (const queryToken of scoredTokens) {
    let best = 0;
    for (const labelToken of labelTokens) {
      best = Math.max(best, tokenScore(queryToken, labelToken));
    }
    tokenScoreSum += best;
  }
  const tokenAverage = scoredTokens.length > 0 ? tokenScoreSum / scoredTokens.length : 0;

  const wholeStringSimilarity = editSimilarity(compactQuery, compactLabel);

  const modelCodes = extractModelCodes(rawQuery);
  const modelCodeBonus = modelCodes.some((code) => labelTokens.includes(code)) ? MODEL_CODE_MATCH_BONUS : 0;

  const combined = Math.max(tokenAverage, wholeStringSimilarity * 0.9);
  const score = Math.min(100, Math.round(combined * 100 + modelCodeBonus));

  const matchType: MatchType =
    normalizedLabel.startsWith(query) || query.startsWith(normalizedLabel)
      ? "PREFIX"
      : normalizedLabel.includes(query)
        ? "CONTAINS"
        : score >= 55
          ? "FUZZY"
          : "WEAK";

  return { score, matchType };
}

/** Extracts DB-fetch anchor tokens from a raw query — the bounded-pool
 * strategy: model-code-like tokens (containing a digit — "26", or a merged
 * short-letter-prefix form like "a26" from "a 26") are the strongest, most
 * selective anchors and are added FIRST whenever present, so they always
 * survive the cap below regardless of what else gets added afterward. A
 * bare short letter token immediately followed by a digit token is merged
 * ("a" + "26" -> "a26") so "A 26" and "A26" extract the same anchor. Any
 * other non-digit Arabic word alongside a digit anchor ("ابل ايفون 17 برو
 * ماكس") also gets a bounded alif/hamza expansion appended (never
 * replacing/outranking the digit anchors — see search-variants.ts). Falls
 * back to non-filler words (brand/category terms — "سامسونج" etc.), same
 * bounded expansion, only when no digit-bearing token exists at all.
 * Capped at 8 anchors either way, so a single DB query is never used to
 * fetch an unbounded pool. */
export function extractAnchorTokens(rawQuery: string): string[] {
  const normalized = normalizeSearchText(rawQuery);
  const tokens = normalized.split(" ").filter(Boolean);
  const anchors = new Set<string>();

  tokens.forEach((token, index) => {
    if (/\d/.test(token)) {
      anchors.add(token);
      // A digit run fused with a non-Latin prefix (e.g. "ا26" from "ا٢٦" —
      // the transliterated Arabic spelling of the Latin letter "A" glued
      // directly to Arabic-Indic digits, no space) would never match a
      // Latin-named PhoneModel via `contains`. Also anchor on the bare
      // digit run itself so the DB pool-fetch still finds "A26" even when
      // the letter prefix is in a different script — the fuzzy scorer
      // above narrows the resulting (slightly broader) pool back down.
      const digitsOnly = token.match(/\d+/)?.[0];
      if (digitsOnly && digitsOnly !== token) anchors.add(digitsOnly);
      const previous = tokens[index - 1];
      if (previous && /^[a-z]{1,3}$/.test(previous)) {
        anchors.add(`${previous}${token}`);
      }
    }
  });

  if (anchors.size > 0) {
    // Digit anchors above remain the strongest, untouched signal (added
    // FIRST, so they always survive the slice below regardless of how many
    // brand-variant anchors get appended). ALSO widen the pool for any
    // non-digit Arabic brand/category word sharing the query, bounded and
    // capped — "ابل ايفون 17 برو ماكس" already finds the real PhoneModel
    // row via "17" landing in its English `name` field, but a brand word
    // persisted with a different hamza spelling than the query ("أبل" vs
    // "ابل", "آيفون" vs "ايفون") should widen the pool too, not rely on
    // that one lucky channel alone — same bounded alif/hamza expansion the
    // no-digit fallback below already uses, never a replacement for the
    // digit anchors' own priority.
    for (const token of tokens) {
      if (anchors.size >= 8) break;
      if (/\d/.test(token) || token.length < 2) continue;
      for (const variant of buildRetrievalVariants(token).slice(0, 3)) {
        if (anchors.size >= 8) break;
        anchors.add(variant);
      }
    }
    return [...anchors].slice(0, 8);
  }

  // No digit anchor at all — this is a pure brand/category-name lookup
  // ("سامسونج", an Arabic category name, …), so the model-code strategy
  // above never applies here regardless of what follows. Same orthography
  // gap as merchant/rep search can bite an Arabic brand/category name too
  // (a hamza variant of a real stored name), so each bare fallback token
  // also gets a bounded alif/hamza expansion (search-variants.ts) — never
  // applied to the digit-anchored branch above, which stays the untouched,
  // strongest signal per its own doc comment.
  const fallbackTokens = stripFillerTerms(normalized)
    .split(" ")
    .filter((token) => token.length >= 2)
    .slice(0, 3);
  const fallback = new Set<string>(fallbackTokens);
  for (const token of fallbackTokens) {
    for (const variant of buildRetrievalVariants(token).slice(0, 3)) {
      fallback.add(variant);
    }
  }
  return [...fallback].slice(0, 8);
}

export type ConfidenceAction = "AUTO_RESOLVE" | "ASK_USER" | "NO_MATCH";

/** Confidence bands — the structural safeguard that stops the model from
 * "arbitrarily deciding": a candidate list is never handed to the model
 * without an explicit, server-computed `recommendedAction`.
 *   - HIGH_SCORE (78): a candidate this strong is trustworthy on its own.
 *   - CLEAR_GAP (15): even a HIGH_SCORE top candidate only auto-resolves if
 *     it leads the runner-up by this much — two close high scores means
 *     genuine ambiguity, never a coin-flip auto-pick.
 *   - ASK_THRESHOLD (40): below this, a "candidate" is too weak to even
 *     offer as a specific choice — treated as NO_MATCH (closest-alternatives
 *     framing) instead of a real disambiguation question. */
export const CONFIDENCE_BANDS = { HIGH_SCORE: 78, CLEAR_GAP: 15, ASK_THRESHOLD: 40 } as const;

export interface RankedCandidate {
  score: number;
  matchType: MatchType;
}

/** Decides, deterministically, what a caller should do with a ranked
 * candidate list — never left to the model's own judgment call. See
 * CONFIDENCE_BANDS for the exact thresholds. */
export function classifyCandidates(ranked: RankedCandidate[]): ConfidenceAction {
  if (ranked.length === 0) return "NO_MATCH";
  const top = ranked[0]!;
  if (top.score < CONFIDENCE_BANDS.ASK_THRESHOLD) return "NO_MATCH";

  const runnerUp = ranked[1];
  const gap = runnerUp ? top.score - runnerUp.score : Infinity;
  if (top.score >= CONFIDENCE_BANDS.HIGH_SCORE && gap >= CONFIDENCE_BANDS.CLEAR_GAP) return "AUTO_RESOLVE";
  return "ASK_USER";
}
