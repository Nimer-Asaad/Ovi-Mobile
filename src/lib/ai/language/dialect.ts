/** Dialect/typo-tolerance layer — the small set of HEAVY, lossy foldings
 * that are safe ONLY as an additional signal for fuzzy SCORING/ROUTING
 * decisions, never for building a DB `contains` filter (Prisma's `contains`
 * does a literal, case-insensitive substring match against the REAL stored
 * text — folding "أحمد" and "احمد" to the same query string would still
 * only ever match rows that literally contain whichever exact spelling was
 * queried; it does NOT retroactively make the DB search hamza-insensitive).
 * See `toMatchable`'s own doc comment for exactly where this is/isn't
 * applied. normalizeSearchText (normalization.ts) — the DB-query-safe,
 * lossless normalization — is unchanged and still the one every DB
 * `contains` filter is built from. */

import { normalizeSearchText } from "@/lib/ai/normalization";

/** Strips one leading Arabic clitic (definite article "ال"/"لل", or an
 * attached one-letter preposition/conjunction "ب"/"ل"/"و"/"ف"/"ك", including
 * the combined forms "بال"/"وال"/"فال"/"كال") — a small, deliberately
 * non-recursive heuristic (real morphology is out of scope), just enough to
 * make lexicon/stopword matching and entity-name extraction work on the
 * attached forms Ovi staff actually type ("بالسيارات", "لمحمد", "الجلد",
 * "للتاجر"). Never applied to fuzzy-scoring itself (fuzzy.ts's own
 * tokenScore already tolerates minor variance via `toMatchable` below) —
 * only to routing/stopword decisions in language/features.ts. */
// "بالله" ("by God" — a fixed filler idiom, FILLER_WORDS/lexicon.ts) LOOKS
// like "بال"+"له" (the combined clitic prefix "بال" + "له") and would
// otherwise strip down to "له" — a real DEBT-glossary term ("عليه له") —
// causing "بالله احمد شو معه؟" to wrongly register as a merchant-debt
// question. A cross-group collision the raw-check-first pattern can't
// catch on its own (matchesLexicalGroup only protects a token from being
// mangled WITHIN the group it's actually checked against; "بالله" is
// never itself a DEBT term, so that check never even fires). Protected
// here, at the source, instead.
const CLITIC_STRIP_EXEMPTIONS = new Set(["بالله"]);

export function stripArabicClitic(token: string): string {
  if (CLITIC_STRIP_EXEMPTIONS.has(token)) return token;
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

/** Longest-first so "هم"/"هن"/"كم" aren't shadowed by a shorter suffix that
 * happens to be one of their own trailing characters. Deliberately excludes
 * a bare "ي" ("my X") — far too many ordinary Arabic words legitimately end
 * in ي (unlike ه/ها/هم/هن/نا/كم, which are comparatively unambiguous as
 * possessive endings in this domain) for a blanket strip to be safe; a
 * specific "my X" form is added as its own literal lexicon entry instead
 * where actually needed. */
const POSSESSIVE_SUFFIXES = ["هن", "هم", "كم", "ها", "نا", "ه"];

/** Strips one trailing Palestinian/MSA possessive suffix from a token —
 * "جفراته" -> "جفرات", "مخزونه" -> "مخزون" — WITHOUT building a full
 * morphological analyzer (real morphology stays explicitly out of scope,
 * same as stripArabicClitic above). A length guard (stem must be >2 chars
 * after stripping) keeps short real words safe ("كم" itself, "منه"/"معه"/
 * "فيه" — already literal CONTEXT_PRONOUNS/RELATION_WORDS entries — are all
 * too short to have anything stripped).
 *
 * Returns BOTH plausible stems, not one, whenever the plain strip leaves a
 * stem ending in "ت": a tāʾ-marbūṭa NOUN's ة becomes a plain ت immediately
 * before an attached suffix in standard Arabic spelling ("ذمة"+"ه" ->
 * "ذمته", "سيارة"+"ه" -> "سيارته"), so the ة-restored form is offered as a
 * second candidate — but the plain stem is always tried FIRST and is very
 * often already correct on its own, since a PLURAL like "جفرات"/"دفعات"
 * also legitimately ends in ت with no ة involved at all ("دفعاته" must
 * stay "دفعات", never become the nonsense "دفعاة"). Only one of the two
 * candidates needs to match a real glossary/lexicon term for either to be
 * useful — offering both costs nothing since matchesLexicalGroup (below)
 * only ever compares against a small, fixed term list.
 *
 * Returns [] when no suffix applies — used only as a FALLBACK comparison
 * in matchesLexicalGroup (lexicon.ts), on the RAW token: a genuine
 * glossary/lexicon word is always tried first, so this never gets a chance
 * to mangle a real word that happens to end the same way before it's been
 * checked as itself. Never mutates anything the user or DB actually sees —
 * purely an internal comparison key. */
export function stripPossessiveSuffix(token: string): string[] {
  for (const suffix of POSSESSIVE_SUFFIXES) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      const stem = token.slice(0, -suffix.length);
      if (suffix === "ه" && stem.endsWith("ت")) return [stem, `${stem.slice(0, -1)}ة`];
      return [stem];
    }
  }
  return [];
}

/** Collapses repeated letters from fast/expressive colloquial typing —
 * "كميييية" -> "كمية", "قدييييش" -> "قديش", "شووو"/"شوو" -> "شو",
 * "دففعات" -> "دفعات", "مخزوون" -> "مخزون". Deliberately LANGUAGE-AWARE
 * (multiple thresholds), not one blanket rule:
 *   - Arabic-script letters (؀-ۿ) OTHER than ل collapse at 2+ repeats
 *     (i.e. ANY doubling, not just 3+). Arabic gemination is written with
 *     a shadda diacritic, never by literally typing a letter twice — so a
 *     doubled letter here is safely assumed to be fat-finger typing
 *     ("شوو"), not a real word. By the time this runs, normalizeSearchText
 *     has already converted Arabic-Indic digits to Latin and stripped
 *     diacritics/tatweel, so nothing but real letters falls in this range.
 *   - ل is handled separately at a stricter 3+ threshold (see
 *     collapseLetterLam's own doc comment) — a doubled ل is disproportio-
 *     nately likely to be GRAMMATICALLY meaningful ("ال" immediately
 *     followed by a ل-initial word, or "ل" immediately followed by "ال"),
 *     not fat-finger typing, unlike every other Arabic letter.
 *   - Everything else (Latin letters, digits) keeps the stricter 3+
 *     threshold — a real product/model name can legitimately contain a
 *     genuine double letter ("Glass", "Book"), so only a CLEARLY
 *     expressive triple-or-more repeat ("Coooool") is collapsed there.
 *
 * A handful of common Arabic/business words are a further, explicit
 * exception even to the 2+ Arabic rule: their double letter is a genuine
 * root/orthographic doubling, not fat-finger typing — found by literally
 * scanning every DOMAIN_GLOSSARY/lexicon term for a repeated-letter pair
 * after this rule's own testing turned up real corruption ("ذمم" -> "ذم",
 * breaking the single most central DEBT-domain word in the entire app).
 * Checked per WORD (raw form first, same pattern as everywhere else in
 * this round), never collapsed even though each contains a doubled
 * letter. This check runs BEFORE any clitic-stripping happens (collapsing
 * is applied to the raw message up front), so a prefixed form that would
 * eventually clitic-strip down to a safe bare word is still corrupted by
 * collapsing FIRST unless it has its own entry here too — hence both
 * "ذمم" and "الذمم" are listed. */
// "اكسسوار"/"إكسسوار" ("accessory", a French/English loanword transliterated
// WITH a genuine doubled س — not fat-finger typing) added this round after
// "اكسسوارات" -> "اكسوارات" corrupted a real catalog-category word into
// something matching nothing.
const SAFE_DOUBLED_LETTER_WORDS = new Set([
  "ذمم", "الذمم", "سدد", "ممكن", "عدد", "اكسسوار", "إكسسوار", "اكسسوارات", "إكسسوارات",
]);

/** ل-specific collapse: only a genuine 3+ repeat is treated as expressive
 * typing. A run of exactly 2 (the far more common case in real messages)
 * is deliberately left untouched — found corrupting "اللزقات" ("ال" +
 * "لزقات", the screen-protector word itself) into "الزقات" (losing the
 * category word's own leading ل entirely, so it no longer matched
 * anything), and "اللي"/"الله"/"للتاجر"/"اعمللي" the same way before this
 * fix existed. Every other clitic-prefix + word-initial-letter
 * combination ("بالبيع", "كالكفر", ...) never produces an adjacent
 * doubled letter in the first place, so ل is a genuinely special case,
 * not a sign the general 2+ rule needs loosening further. */
function collapseLetterLam(word: string): string {
  return word.replace(/ل{3,}/gu, "ل");
}

/** Collapses a run of 3+ repeats down to exactly TWO (never all the way to
 * one) — used only to test whether an over-typed safe-doubled-letter word
 * ("ذمممم", 4 م) is really just that safe word ("ذمم") with a few EXTRA
 * accidental repeats on top of its genuine double, before deciding how to
 * collapse it for real. Deliberately never applied as the general rule —
 * only 3+ collapses here, so an ordinary already-correct double ("ذمم"
 * itself, exactly 2 م) is left untouched by this check and still matches
 * SAFE_DOUBLED_LETTER_WORDS directly. */
function collapseToDoubleAtMost(word: string): string {
  return word.replace(/([؀-ۿ])\1{2,}/gu, "$1$1");
}

function collapseWord(word: string): string {
  if (SAFE_DOUBLED_LETTER_WORDS.has(word)) return word;
  const conservative = collapseToDoubleAtMost(word);
  if (SAFE_DOUBLED_LETTER_WORDS.has(conservative)) return conservative;
  return collapseLetterLam(word)
    // Every Arabic letter EXCEPT ل still collapses at 2+ — the replacer
    // leaves a matched "لل" pair exactly as-is (ل is handled separately,
    // above, at its own stricter 3+ threshold) and collapses everything
    // else to its single letter.
    .replace(/([؀-ۿ])\1+/gu, (match, letter: string) => (letter === "ل" ? match : letter))
    .replace(/([^؀-ۿ])\1{2,}/gu, "$1");
}

export function collapseExpressiveRepeats(text: string): string {
  return text.split(" ").map(collapseWord).join(" ");
}

/** Folds the three hamza-carrying alef forms (أ/إ/آ) to bare ا, and ى
 * (alef maksura) to bare ي — variance Ovi staff type interchangeably for
 * the SAME word ("أحمد"/"احمد", "على"/"علي" as a name) but which
 * normalizeSearchText deliberately leaves alone (see its own doc comment:
 * "those ARE meaningfully distinct in real product names"). Scoped to
 * `toMatchable` only — applied to a fuzzy-scoring COMPARISON copy of the
 * text, never to the text used to build a DB `contains` filter. */
function foldHamzaAndAlefMaksura(text: string): string {
  return text.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
}

/** The one function that turns a normalized string into its "heavy fold"
 * comparison form — hamza/alef-maksura unification + expressive-repeat
 * collapsing, on top of normalizeSearchText's own lossless normalization.
 * Used by fuzzy.ts's scoreCandidateLabel as an ADDITIONAL ranking signal
 * (never replacing the exact/prefix/substring tiers, which still compare
 * the lossless form first) and by language/features.ts when comparing a
 * learned-alias phrase (see local/entity-resolution.ts). Idempotent —
 * safe to call on already-normalized text. */
export function toMatchable(text: string): string {
  return collapseExpressiveRepeats(foldHamzaAndAlefMaksura(normalizeSearchText(text)));
}
