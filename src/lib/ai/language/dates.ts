/** Palestinian date/period phrase detection — pure, no DB, no date
 * arithmetic here (that lives in the ONE canonical place, resolvePeriod,
 * src/lib/ai/tools/sales.ts, anchored on the real Palestine business-time
 * helper). This module only recognizes WHICH period tag a message asked
 * for; resolvePeriod turns that tag into concrete ISO dates. Never a second
 * competing date calculation. */

import { normalizeSearchText } from "@/lib/ai/normalization";
import { collapseExpressiveRepeats, stripArabicClitic } from "@/lib/ai/language/dialect";
import type { SalesPeriodInput } from "@/lib/ai/tools/sales";

const norm = (term: string) => normalizeSearchText(term);

const TODAY_WORDS = ["اليوم", "هاليوم", "اليوم هاد", "هالنهار", "النهارده", "today"];
const YESTERDAY_WORDS = ["مبارح", "امبارح", "إمبارح", "البارح", "أمس", "امس", "yesterday"];
const DAY_BEFORE_YESTERDAY_PHRASES = ["اول مبارح", "أول مبارح", "اول امبارح", "أول امبارح", "قبل مبارح", "قبل امبارح"];
const THIS_WEEK_PHRASES = ["هالاسبوع", "هالأسبوع", "هذا الاسبوع", "هذا الأسبوع", "الاسبوع هاد", "الأسبوع هاد", "من اول الاسبوع", "من أول الأسبوع", "this week"];
const LAST_WEEK_PHRASES = ["الاسبوع الماضي", "الأسبوع الماضي", "الاسبوع اللي فات", "الأسبوع اللي فات", "الاسبوع الفات", "الأسبوع الفات"];
const THIS_MONTH_PHRASES = ["هالشهر", "هذا الشهر", "الشهر هاد", "من اول الشهر", "من أول الشهر", "الشهر الحالي", "this month"];
const LAST_MONTH_PHRASES = ["الشهر الماضي", "الشهر اللي فات", "الشهر الفات", "last month"];

/** "آخر يومين"/"اخر 3 ايام"/"آخر أسبوع" — a bounded recent-N-days window.
 * "آخر أسبوع"/"اخر اسبوع" (no explicit number) defaults to 7 days, matching
 * THIS_WEEK's own 7-day window. Capped at 90 days by resolvePeriod itself
 * regardless of what's parsed here. */
function detectRecentNDays(normalized: string): number | null {
  const numericMatch = normalized.match(/(?:اخر|آخر)\s+(\d+)\s+(?:يوم|ايام|أيام)/);
  if (numericMatch?.[1]) return Number(numericMatch[1]);

  // Both the MSA-standard number form ("ستة"/"سبعة") and the common
  // colloquial form with the ة dropped ("ست"/"سبع" — "آخر سبع أيام") are
  // recognized, matching how 3/4/5 were already stored (colloquial-only).
  const wordNumbers: Record<string, number> = { يومين: 2, ثلاث: 3, اربع: 4, أربع: 4, خمس: 5, ست: 6, ستة: 6, سبع: 7, سبعة: 7 };
  for (const [word, count] of Object.entries(wordNumbers)) {
    if (normalized.includes(`اخر ${word}`) || normalized.includes(`آخر ${word}`)) return count;
  }
  if (normalized.includes("اخر اسبوع") || normalized.includes("آخر أسبوع") || normalized.includes("اخر أسبوع") || normalized.includes("آخر اسبوع")) return 7;
  return null;
}

/** The local date/period parser's single entry point — deterministic,
 * synchronous, returns a period TAG (never resolved dates) or null when the
 * message named no period at all (the caller then either applies its own
 * default or leaves the period unset). Order matters: multi-word/more
 * specific phrases are checked before their shorter, more generic
 * substrings ("الاسبوع الماضي" before a bare "الاسبوع" match, "اول مبارح"
 * before bare "مبارح") so e.g. "الأسبوع الماضي" is never misread as
 * THIS_WEEK just because "الأسبوع" alone would also match. */
export function detectDatePeriod(rawMessage: string): SalesPeriodInput | null {
  // Same expressive-repeat collapsing language/features.ts's own
  // extractQueryFeatures and intent.ts's classifyIntent already apply
  // ("مباارح" -> "مبارح") — found missing here this round: router.ts calls
  // this function with the RAW message (never the already-collapsed
  // text), so an expressively-typed period word silently failed to match
  // any of the phrase/token lists below despite matching everywhere else.
  const normalized = collapseExpressiveRepeats(norm(rawMessage));
  if (!normalized) return null;
  const tokens = normalized.split(" ").filter(Boolean);

  const recentDays = detectRecentNDays(normalized);
  if (recentDays !== null) return { type: "LAST_N_DAYS", days: recentDays };

  if (DAY_BEFORE_YESTERDAY_PHRASES.some((phrase) => normalized.includes(norm(phrase)))) return { type: "DAY_BEFORE_YESTERDAY" };
  if (LAST_WEEK_PHRASES.some((phrase) => normalized.includes(norm(phrase)))) return { type: "LAST_WEEK" };
  if (LAST_MONTH_PHRASES.some((phrase) => normalized.includes(norm(phrase)))) return { type: "LAST_MONTH" };
  if (THIS_WEEK_PHRASES.some((phrase) => normalized.includes(norm(phrase)))) return { type: "THIS_WEEK" };
  if (THIS_MONTH_PHRASES.some((phrase) => normalized.includes(norm(phrase)))) return { type: "THIS_MONTH" };
  // Clitic-aware — a conversational-follow-up "و"+word fusion ("ومبارح؟"
  // after "شو بعنا؟") is checked against its declitic'd form too, the same
  // gap already fixed elsewhere this round for classifyIntent/features.ts.
  if (tokens.some((token) => YESTERDAY_WORDS.map(norm).includes(token) || YESTERDAY_WORDS.map(norm).includes(stripArabicClitic(token)))) return { type: "YESTERDAY" };
  if (tokens.some((token) => TODAY_WORDS.map(norm).includes(token) || TODAY_WORDS.map(norm).includes(stripArabicClitic(token)))) return { type: "TODAY" };

  return null;
}
